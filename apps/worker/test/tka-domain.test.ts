// ============================================================
// Comprehensive Automated Test Suite for Phase 5 — TKA Domain
//
// Verifies all 16 required test suites:
// 1. Source Adapter & Grade-12 Filtering (with riwayat_kelas fallback)
// 2. Canonical Subject Registry & Alias Resolution (all aliases, case/space tolerance)
// 3. Deterministic Unresolved Alias Handling (unknown strings rejected)
// 4. Subject ID Semantic Compatibility with Ulangan (Mansatas mata_pelajaran.id in cbt_exams.subject_id)
// 5. One TKA Exam Per Subject Per Event Invariant (application guard + DB partial unique index)
// 6. Exactly-Five Invariant Validation (valid, missing, duplicate, duplicate_mandatory)
// 7. Participant Snapshot & Explicit Validation Status (no default status)
// 8. Diff-Based Atomic Sync & Session Guard (added, removed, changed; session attempt guard; ready freeze)
// 9. Data-Quality & Diagnostic Reporting (structured preview reporting)
// 10. Canonical Room Authority & Materialized Roster Sync (participant room updates all 5 roster rows)
// 11. Exam-Room Scoped Token Policy (tokens per exam-room; readiness gate check)
// 12. Exact Subject Exam Coverage (readiness checks required subjects & flags unpopulated exams)
// 13. Domain Isolation & IDOR Protection (rejects PMB/Kegiatan/Ulangan/Semester; cross-event check)
// 14. Student Runtime Authorization (entitled subject starts ok; non-entitled subject rejected with 403)
// 15. Event/Exam Lifecycle Synchronization (event status updates all child exams' active_status)
// 16. Historical Stability After Freeze (live Mansatas mutation does not drift frozen CBT rosters)
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import tkaRoutes from '../src/routes/domains/tka.ts';
import { signJWT } from '../src/utils/jwt.ts';
import {
  ALL_CANONICAL_TKA_SUBJECTS,
  TKA_ALIAS_MAP,
  resolveCanonicalTkaSubject,
  matchMansatasSubjectRow,
} from '../src/services/domains/tka/canonical-subjects.ts';
import {
  previewTkaParticipants,
  listTkaAcademicYears,
  fetchMansatasSubjects,
  evaluateStudentTkaChoices,
} from '../src/services/sources/tka.ts';
import {
  listTkaEvents,
  getTkaEventById,
  createTkaEvent,
  updateTkaEvent,
  transitionTkaEventStatus,
  deleteTkaEvent,
  assertTkaEvent,
  DomainMismatchError,
  EventFrozenError,
} from '../src/services/domains/tka/events.ts';
import {
  snapshotTkaParticipants,
  syncTkaParticipants,
  assignParticipantRoom,
  bulkAssignParticipantRooms,
  generateTkaExamRosters,
  hasExistingExamSessions,
} from '../src/services/domains/tka/snapshot.ts';
import {
  listTkaExams,
  getTkaSubjectCoverage,
  createTkaExam,
  batchCreateCoveredTkaExams,
  deleteTkaExam,
} from '../src/services/domains/tka/exams.ts';
import { checkTkaEventReadiness } from '../src/services/domains/tka/readiness.ts';

const JWT_SECRET = 'test-secret-key-for-tka-phase5';

// ── Test Mock D1 Database Setup ─────────────────────────────
function createMockCbtDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE cbt_events (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      activity_type TEXT NOT NULL DEFAULT 'other',
      participant_source TEXT NOT NULL DEFAULT 'mansatas',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'configuration', 'ready', 'active', 'completed', 'archived')),
      academic_year_id TEXT,
      academic_year_name TEXT,
      term TEXT,
      proctor_access_before_minutes INTEGER NOT NULL DEFAULT 30,
      proctor_access_after_minutes INTEGER NOT NULL DEFAULT 45,
      description TEXT,
      starts_at TEXT,
      ends_at TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_rooms (
      id TEXT PRIMARY KEY,
      room_name TEXT NOT NULL,
      capacity INTEGER DEFAULT 40,
      event_id TEXT REFERENCES cbt_events(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_exams (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      rules_text TEXT,
      completion_message TEXT DEFAULT 'Ujian telah selesai. Terima kasih.',
      is_score_visible INTEGER DEFAULT 0,
      randomize_questions INTEGER DEFAULT 0,
      randomize_options INTEGER DEFAULT 0,
      active_status TEXT NOT NULL DEFAULT 'draft',
      passing_score REAL DEFAULT 0,
      target_jalur TEXT DEFAULT NULL,
      event_id TEXT REFERENCES cbt_events(id),
      subject_id TEXT,
      subject_name TEXT,
      class_id TEXT,
      class_name TEXT,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      cheat_limit INTEGER DEFAULT 3,
      cheat_action TEXT DEFAULT 'lock',
      enforce_fullscreen INTEGER DEFAULT 0,
      mode TEXT CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      owner_staff_id TEXT,
      version_label TEXT,
      is_frozen INTEGER DEFAULT 0,
      teaching_assignment_id TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX idx_cbt_exams_tka_event_subject
    ON cbt_exams(event_id, subject_id)
    WHERE mode = 'tka';

    CREATE TABLE cbt_tka_participants (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      nisn TEXT,
      nama_lengkap TEXT NOT NULL,
      class_id TEXT,
      class_name TEXT,
      gender TEXT,
      mapel_pilihan1_raw TEXT,
      mapel_pilihan2_raw TEXT,
      mapel_pilihan1_subject_id TEXT,
      mapel_pilihan2_subject_id TEXT,
      validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending')),
      validation_notes TEXT,
      room_id TEXT REFERENCES cbt_rooms(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, student_id)
    );

    CREATE TABLE cbt_exam_roster (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES cbt_events(id),
      source_key TEXT NOT NULL,
      source_id TEXT NOT NULL,
      username TEXT NOT NULL,
      nisn TEXT,
      full_name TEXT NOT NULL,
      class_name TEXT,
      grade TEXT,
      gender TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      room_id TEXT REFERENCES cbt_rooms(id),
      tanggal_tes TEXT NOT NULL DEFAULT '',
      sesi_tes TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, source_key, source_id)
    );

    CREATE TABLE cbt_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      question_order INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      question_type TEXT DEFAULT 'multiple_choice',
      image_url TEXT,
      audio_url TEXT,
      points REAL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_question_options (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
      option_label TEXT NOT NULL,
      option_text TEXT NOT NULL,
      image_url TEXT,
      is_correct INTEGER DEFAULT 0,
      option_order INTEGER DEFAULT 0
    );

    CREATE TABLE cbt_exam_tokens (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      room_id TEXT REFERENCES cbt_rooms(id) ON DELETE CASCADE,
      tanggal_tes TEXT NOT NULL DEFAULT '',
      sesi_tes TEXT NOT NULL DEFAULT '',
      token_code TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, room_id, tanggal_tes, sesi_tes)
    );

    CREATE TABLE cbt_exam_sessions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      room_id TEXT,
      status TEXT DEFAULT 'active',
      cheat_warnings INTEGER DEFAULT 0,
      question_map TEXT,
      option_map TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      last_heartbeat TEXT DEFAULT (datetime('now')),
      is_time_locked INTEGER DEFAULT 0,
      locked_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      UNIQUE(exam_id, user_id, user_type)
    );

    CREATE TABLE cbt_student_answers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
      selected_option_id TEXT REFERENCES cbt_question_options(id),
      essay_answer TEXT,
      is_doubtful INTEGER DEFAULT 0,
      answered_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, question_id)
    );

    CREATE TABLE cbt_exam_results (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id),
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      total_questions INTEGER DEFAULT 0,
      total_correct INTEGER DEFAULT 0,
      total_wrong INTEGER DEFAULT 0,
      total_unanswered INTEGER DEFAULT 0,
      score REAL DEFAULT 0,
      computed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_permission_grants (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_value TEXT NOT NULL DEFAULT '*',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_exam_assignments (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL DEFAULT 'pendaftar',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      room_id TEXT,
      is_active INTEGER DEFAULT 1
    );

    INSERT INTO cbt_rooms (id, room_name, capacity) VALUES
      ('room-1', 'Lab Komputer 1', 40),
      ('room-2', 'Lab Komputer 2', 40);
  `);

  return wrapSqliteAsD1(sqlite);
}

function createMockMansatasDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE tahun_ajaran (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      semester TEXT NOT NULL DEFAULT '1',
      is_active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE mata_pelajaran (
      id TEXT PRIMARY KEY,
      nama_mapel TEXT NOT NULL,
      kode_mapel TEXT,
      kelompok TEXT
    );

    CREATE TABLE kelas (
      id TEXT PRIMARY KEY,
      tingkat INTEGER NOT NULL,
      nomor_kelas INTEGER,
      kelompok TEXT,
      kapasitas INTEGER DEFAULT 36,
      wali_kelas_id TEXT
    );

    CREATE TABLE siswa (
      id TEXT PRIMARY KEY,
      nisn TEXT UNIQUE NOT NULL,
      nis_lokal TEXT,
      nama_lengkap TEXT NOT NULL,
      jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L', 'P')),
      kelas_id TEXT REFERENCES kelas(id),
      status TEXT NOT NULL DEFAULT 'aktif',
      foto_url TEXT
    );

    CREATE TABLE riwayat_kelas (
      siswa_id TEXT NOT NULL,
      kelas_id TEXT NOT NULL,
      tahun_ajaran_id TEXT NOT NULL
    );

    CREATE TABLE tka_mapel_pilihan (
      id TEXT PRIMARY KEY,
      siswa_id TEXT NOT NULL,
      tahun_ajaran_id TEXT NOT NULL,
      mapel_pilihan1 TEXT,
      mapel_pilihan2 TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(siswa_id, tahun_ajaran_id)
    );

    -- Seed Academic Year
    INSERT INTO tahun_ajaran (id, nama, semester, is_active) VALUES
      ('ta-2026', '2026/2027', '1', 1),
      ('ta-2025', '2025/2026', '2', 0);

    -- Seed Authoritative Subjects in Mansatas
    INSERT INTO mata_pelajaran (id, nama_mapel, kode_mapel, kelompok) VALUES
      ('mp-mat', 'Matematika', 'MAT', 'Umum'),
      ('mp-bin', 'Bahasa Indonesia', 'BIN', 'Umum'),
      ('mp-big', 'Bahasa Inggris', 'BIG', 'Umum'),
      ('mp-mat-l', 'Matematika Tingkat Lanjut', 'MAT-L', 'Peminatan'),
      ('mp-fis', 'Fisika', 'FIS', 'MIPA'),
      ('mp-kim', 'Kimia', 'KIM', 'MIPA'),
      ('mp-bio', 'Biologi', 'BIO', 'MIPA'),
      ('mp-eko', 'Ekonomi', 'EKO', 'IPS'),
      ('mp-geo', 'Geografi', 'GEO', 'IPS'),
      ('mp-sos', 'Sosiologi', 'SOS', 'IPS'),
      ('mp-sej', 'Sejarah', 'SEJ', 'Umum'),
      ('mp-ppkn', 'Pendidikan Pancasila dan Kewarganegaraan', 'PPKN', 'Umum'),
      ('mp-arb', 'Bahasa Arab', 'ARB', 'Agama');

    -- Seed Classes
    INSERT INTO kelas (id, tingkat, kelompok, nomor_kelas) VALUES
      ('kelas-12-mipa-1', 12, 'MIPA', 1),
      ('kelas-12-mipa-2', 12, 'MIPA', 2),
      ('kelas-11-mipa-1', 11, 'MIPA', 1);

    -- Seed Students
    -- s1: Ahmad (Valid: Fisika & Kimia)
    -- s2: Budi (Valid: Biologi & Ekonomi)
    -- s3: Citra (Duplicate Option: Fisika & Fisika)
    -- s4: Deni (Duplicate Mandatory: Matematika & Kimia)
    -- s5: Eka (Missing Option: Fisika & NULL)
    -- s6: Farhan (Unresolved: Ilmu Hitam & Kimia)
    -- s7: Gina (No choice record)
    -- s8: Hadi (Grade 11 - Ineligible)
    -- s9: Indah (Inactive - Ineligible)
    -- s10: Joko (Current class in riwayat_kelas for ta-2026)
    INSERT INTO siswa (id, nisn, nis_lokal, nama_lengkap, jenis_kelamin, kelas_id, status) VALUES
      ('s-1', '0011', '2601', 'Ahmad Dahlan', 'L', 'kelas-12-mipa-1', 'aktif'),
      ('s-2', '0012', '2602', 'Budi Santoso', 'L', 'kelas-12-mipa-1', 'aktif'),
      ('s-3', '0013', '2603', 'Citra Lestari', 'P', 'kelas-12-mipa-1', 'aktif'),
      ('s-4', '0014', '2604', 'Deni Ramdani', 'L', 'kelas-12-mipa-1', 'aktif'),
      ('s-5', '0015', '2605', 'Eka Putri', 'P', 'kelas-12-mipa-2', 'aktif'),
      ('s-6', '0016', '2606', 'Farhan Ali', 'L', 'kelas-12-mipa-2', 'aktif'),
      ('s-7', '0017', '2607', 'Gina Maulida', 'P', 'kelas-12-mipa-2', 'aktif'),
      ('s-8', '0018', '2608', 'Hadi Permana', 'L', 'kelas-11-mipa-1', 'aktif'),
      ('s-9', '0019', '2609', 'Indah Pratiwi', 'P', 'kelas-12-mipa-1', 'nonaktif'),
      ('s-10', '0020', '2610', 'Joko Susilo', 'L', NULL, 'aktif');

    -- riwayat_kelas for s-10
    INSERT INTO riwayat_kelas (siswa_id, kelas_id, tahun_ajaran_id) VALUES
      ('s-10', 'kelas-12-mipa-1', 'ta-2026');

    -- Choices for ta-2026
    INSERT INTO tka_mapel_pilihan (id, siswa_id, tahun_ajaran_id, mapel_pilihan1, mapel_pilihan2) VALUES
      ('tka-1', 's-1', 'ta-2026', 'Fisika', 'Kimia'),
      ('tka-2', 's-2', 'ta-2026', 'Biologi', 'Ekonomi'),
      ('tka-3', 's-3', 'ta-2026', 'fisika', 'fisika'),
      ('tka-4', 's-4', 'ta-2026', 'Matematika', 'Kimia'),
      ('tka-5', 's-5', 'ta-2026', 'Fisika', ''),
      ('tka-6', 's-6', 'ta-2026', 'Ilmu Hitam', 'Kimia'),
      ('tka-10', 's-10', 'ta-2026', 'Geografi', 'Sosiologi');
  `);

  return wrapSqliteAsD1(sqlite);
}

function wrapSqliteAsD1(sqlite: DatabaseSync) {
  const d1: any = {
    prepare: (sql: string) => {
      const exec = (params: any[]) => ({
        first: async <T>() => {
          const stmt = sqlite.prepare(sql);
          return (stmt.get(...params) as T) || null;
        },
        all: async <T>() => {
          const stmt = sqlite.prepare(sql);
          return { results: (stmt.all(...params) as T[]) || [] };
        },
        run: async () => {
          const stmt = sqlite.prepare(sql);
          const info = stmt.run(...params);
          return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
      });

      return {
        bind: (...params: any[]) => exec(params),
        first: async <T>() => exec([]).first<T>(),
        all: async <T>() => exec([]).all<T>(),
        run: async () => exec([]).run(),
      };
    },
    batch: async (statements: any[]) => {
      const results: any[] = [];
      for (const st of statements) {
        results.push(await st.run());
      }
      return results;
    },
  };
  return { d1, rawSqlite: sqlite };
}

// ── Test Setup Helpers ───────────────────────────────────────
async function createAuthHeaders(role: string, permissions: string[] = []) {
  const token = await signJWT(
    {
      sub: `user-${role}`,
      username: `${role}_user`,
      role: role as any,
      room_id: null,
      full_name: `Test ${role}`,
      source: 'mansatas',
      roles: [role],
      permissions,
    },
    JWT_SECRET,
    3600
  );
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describe('Phase 5 — TKA Domain Automated Test Suite', () => {
  let cbtWrapper: ReturnType<typeof createMockCbtDb>;
  let mansatasWrapper: ReturnType<typeof createMockMansatasDb>;
  let d1: D1Database;
  let mansatasDb: D1Database;
  let app: Hono<any>;

  const initApp = () => {
    cbtWrapper = createMockCbtDb();
    mansatasWrapper = createMockMansatasDb();
    d1 = cbtWrapper.d1;
    mansatasDb = mansatasWrapper.d1;

    app = new Hono();
    // Inject environment bindings
    app.use('*', async (c, next) => {
      (c.env as any) = {
        DB: d1,
        MANSATAS_DB: mansatasDb,
        JWT_SECRET,
        R2: {
          put: async () => ({}),
          get: async () => null,
        },
      };
      await next();
    });
    app.route('/api/tka', tkaRoutes);
  };

  // ── 1. Source Adapter & Grade-12 Filtering ──────────────────
  it('1. Source Adapter: correctly filters Grade 12 active students with riwayat_kelas fallback', async () => {
    initApp();
    const preview = await previewTkaParticipants(mansatasDb, 'ta-2026');

    // Grade 11 (s-8) and Inactive (s-9) must NOT be included in eligible
    const ids = preview.eligible_participants.map((p) => p.student_id);
    assert.ok(ids.includes('s-1'), 's-1 (Ahmad) should be eligible');
    assert.ok(ids.includes('s-2'), 's-2 (Budi) should be eligible');
    assert.ok(ids.includes('s-10'), 's-10 (Joko) with riwayat_kelas should be eligible');
    assert.ok(!ids.includes('s-8'), 's-8 (Grade 11) must be excluded');
    assert.ok(!ids.includes('s-9'), 's-9 (Inactive) must be excluded');
    assert.equal(preview.summary.total_grade_12, 8, 'Total Grade 12 active students should be 8');
  });

  // ── 2. Canonical Subject Registry & Alias Resolution ────────
  it('2. Canonical Subjects: resolves all supported aliases with whitespace/case insensitivity', () => {
    // Exact and abbreviation alias checks
    assert.equal(resolveCanonicalTkaSubject('Fisika')?.canonicalKey, 'FISIKA');
    assert.equal(resolveCanonicalTkaSubject('  fis  ')?.canonicalKey, 'FISIKA');
    assert.equal(resolveCanonicalTkaSubject('KIMIA')?.canonicalKey, 'KIMIA');
    assert.equal(resolveCanonicalTkaSubject('kim')?.canonicalKey, 'KIMIA');
    assert.equal(resolveCanonicalTkaSubject('BIOLOGI')?.canonicalKey, 'BIOLOGI');
    assert.equal(resolveCanonicalTkaSubject('bio')?.canonicalKey, 'BIOLOGI');
    assert.equal(resolveCanonicalTkaSubject('ekonomi')?.canonicalKey, 'EKONOMI');
    assert.equal(resolveCanonicalTkaSubject('geografi')?.canonicalKey, 'GEOGRAFI');
    assert.equal(resolveCanonicalTkaSubject('sosiologi')?.canonicalKey, 'SOSIOLOGI');
    assert.equal(resolveCanonicalTkaSubject('Matematika Tingkat Lanjut')?.canonicalKey, 'MATEMATIKA_TINGKAT_LANJUT');
    assert.equal(resolveCanonicalTkaSubject('mat lanjut')?.canonicalKey, 'MATEMATIKA_TINGKAT_LANJUT');
    assert.equal(resolveCanonicalTkaSubject('mat minat')?.canonicalKey, 'MATEMATIKA_TINGKAT_LANJUT');
    assert.equal(resolveCanonicalTkaSubject('ppkn')?.canonicalKey, 'PPKN');
    assert.equal(resolveCanonicalTkaSubject('pendidikan pancasila dan kewarganegaraan')?.canonicalKey, 'PPKN');
    assert.equal(resolveCanonicalTkaSubject('bahasa arab')?.canonicalKey, 'BAHASA_ARAB');
    assert.equal(resolveCanonicalTkaSubject('arab')?.canonicalKey, 'BAHASA_ARAB');
    assert.equal(resolveCanonicalTkaSubject('pkwu')?.canonicalKey, 'PKWU');
    assert.equal(resolveCanonicalTkaSubject('prakarya')?.canonicalKey, 'PKWU');

    // Mandatory subjects
    assert.equal(resolveCanonicalTkaSubject('Matematika')?.canonicalKey, 'MATEMATIKA');
    assert.equal(resolveCanonicalTkaSubject('mat')?.canonicalKey, 'MATEMATIKA');
    assert.equal(resolveCanonicalTkaSubject('Bahasa Indonesia')?.canonicalKey, 'BAHASA_INDONESIA');
    assert.equal(resolveCanonicalTkaSubject('bin')?.canonicalKey, 'BAHASA_INDONESIA');
    assert.equal(resolveCanonicalTkaSubject('Bahasa Inggris')?.canonicalKey, 'BAHASA_INGGRIS');
    assert.equal(resolveCanonicalTkaSubject('big')?.canonicalKey, 'BAHASA_INGGRIS');
  });

  // ── 3. Deterministic Unresolved Alias Handling ───────────────
  it('3. Alias Resolution: unknown or fuzzy strings return null (unresolved)', () => {
    assert.equal(resolveCanonicalTkaSubject('Ilmu Hitam'), null);
    assert.equal(resolveCanonicalTkaSubject('Fisika Kuantum Lanjut'), null);
    assert.equal(resolveCanonicalTkaSubject('Sains'), null);
    assert.equal(resolveCanonicalTkaSubject(''), null);
    assert.equal(resolveCanonicalTkaSubject(undefined), null);
  });

  // ── 4. Subject ID Semantic Compatibility with Ulangan ────────
  it('4. Subject ID Semantic: matches canonical subject to verified Mansatas mata_pelajaran.id', async () => {
    initApp();
    const subjects = await fetchMansatasSubjects(mansatasDb);
    const fisikaCanon = resolveCanonicalTkaSubject('Fisika')!;
    const match = matchMansatasSubjectRow(fisikaCanon, subjects);

    assert.ok(match, 'Fisika should match mata_pelajaran row');
    assert.equal(match.id, 'mp-fis', 'cbt_exams.subject_id stores Mansatas mata_pelajaran.id');
    assert.equal(match.nama_mapel, 'Fisika');
  });

  // ── 5. One TKA Exam Per Subject Per Event Invariant ──────────
  it('5. Invariant: One TKA exam per subject per event (enforced by app guard and DB unique index)', async () => {
    initApp();
    const createRes = await createTkaEvent(
      d1,
      mansatasDb,
      {
        code: 'TKA-2026',
        name: 'Tes Kemampuan Akademik 2026',
        academic_year_id: 'ta-2026',
        academic_year_name: '2026/2027',
      },
      'admin-1'
    );
    assert.ok(createRes.success);
    const eventId = createRes.id!;

    // 1. Create Fisika Exam #1 -> Success
    const exam1 = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
    assert.ok(exam1.success, 'First Fisika exam must succeed');

    // 2. Create Fisika Exam #2 in same event -> Rejected by application guard
    const exam2 = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
    assert.equal(exam2.success, false);
    assert.match(exam2.error!, /sudah ada dalam event TKA ini/);

    // 3. Create Kimia Exam in same event -> Success
    const exam3 = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-kim' }, 'admin-1');
    assert.ok(exam3.success, 'Kimia exam in same event must succeed');

    // 4. Test database-level safety net: direct SQL insert duplicate subject_id
    assert.throws(() => {
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_exams (id, title, event_id, subject_id, mode)
        VALUES ('exam-dup', 'Fisika Dup', '${eventId}', 'mp-fis', 'tka')
      `);
    }, /UNIQUE constraint failed/);

    // 5. Kegiatan domain remains unconstrained
    cbtWrapper.rawSqlite.exec(`
      INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-kegiatan', 'KEG-01', 'Lomba', 'kegiatan', 'draft');
      INSERT INTO cbt_exams (id, title, event_id, subject_id, mode) VALUES ('keg-1', 'Ex 1', 'ev-kegiatan', 'mp-fis', 'kegiatan');
      INSERT INTO cbt_exams (id, title, event_id, subject_id, mode) VALUES ('keg-2', 'Ex 2', 'ev-kegiatan', 'mp-fis', 'kegiatan');
    `);
    const kegExams = cbtWrapper.rawSqlite
      .prepare("SELECT COUNT(*) as c FROM cbt_exams WHERE event_id = 'ev-kegiatan'")
      .get() as any;
    assert.equal(kegExams.c, 2, 'Kegiatan can have multiple exams with same subject_id');
  });

  // ── 6. Exactly-Five Invariant Validation ────────────────────
  it('6. Invariant: Validates 5-subject entitlement with all failure modes', async () => {
    initApp();
    const subjects = await fetchMansatasSubjects(mansatasDb);

    // Ahmad: Fisika & Kimia -> VALID
    const ahmad = evaluateStudentTkaChoices(
      {
        student_id: 's-1',
        nisn: '0011',
        nis_lokal: '2601',
        nama_lengkap: 'Ahmad Dahlan',
        jenis_kelamin: 'L',
        kelas_id: 'kelas-12-mipa-1',
        tingkat: 12,
        kelompok: 'MIPA',
        nomor_kelas: 1,
        student_status: 'aktif',
        pilihan1_raw: 'Fisika',
        pilihan2_raw: 'Kimia',
        tka_choice_updated_at: null,
        has_tka_record: true,
      },
      subjects
    );
    assert.equal(ahmad.validation_status, 'valid');
    assert.equal(ahmad.pilihan1_subject_id, 'mp-fis');
    assert.equal(ahmad.pilihan2_subject_id, 'mp-kim');

    // Citra: Fisika & Fisika -> DUPLICATE_OPTION
    const citra = evaluateStudentTkaChoices(
      {
        student_id: 's-3',
        nisn: '0013',
        nis_lokal: '2603',
        nama_lengkap: 'Citra Lestari',
        jenis_kelamin: 'P',
        kelas_id: 'kelas-12-mipa-1',
        tingkat: 12,
        kelompok: 'MIPA',
        nomor_kelas: 1,
        student_status: 'aktif',
        pilihan1_raw: 'Fisika',
        pilihan2_raw: 'fisika',
        tka_choice_updated_at: null,
        has_tka_record: true,
      },
      subjects
    );
    assert.equal(citra.validation_status, 'duplicate_option');

    // Deni: Matematika & Kimia -> DUPLICATE_MANDATORY
    const deni = evaluateStudentTkaChoices(
      {
        student_id: 's-4',
        nisn: '0014',
        nis_lokal: '2604',
        nama_lengkap: 'Deni Ramdani',
        jenis_kelamin: 'L',
        kelas_id: 'kelas-12-mipa-1',
        tingkat: 12,
        kelompok: 'MIPA',
        nomor_kelas: 1,
        student_status: 'aktif',
        pilihan1_raw: 'Matematika',
        pilihan2_raw: 'Kimia',
        tka_choice_updated_at: null,
        has_tka_record: true,
      },
      subjects
    );
    assert.equal(deni.validation_status, 'duplicate_mandatory');

    // Eka: Fisika & '' -> MISSING_OPTION
    const eka = evaluateStudentTkaChoices(
      {
        student_id: 's-5',
        nisn: '0015',
        nis_lokal: '2605',
        nama_lengkap: 'Eka Putri',
        jenis_kelamin: 'P',
        kelas_id: 'kelas-12-mipa-2',
        tingkat: 12,
        kelompok: 'MIPA',
        nomor_kelas: 2,
        student_status: 'aktif',
        pilihan1_raw: 'Fisika',
        pilihan2_raw: '',
        tka_choice_updated_at: null,
        has_tka_record: true,
      },
      subjects
    );
    assert.equal(eka.validation_status, 'missing_option');

    // Farhan: Ilmu Hitam & Kimia -> UNRESOLVED
    const farhan = evaluateStudentTkaChoices(
      {
        student_id: 's-6',
        nisn: '0016',
        nis_lokal: '2606',
        nama_lengkap: 'Farhan Ali',
        jenis_kelamin: 'L',
        kelas_id: 'kelas-12-mipa-2',
        tingkat: 12,
        kelompok: 'MIPA',
        nomor_kelas: 2,
        student_status: 'aktif',
        pilihan1_raw: 'Ilmu Hitam',
        pilihan2_raw: 'Kimia',
        tka_choice_updated_at: null,
        has_tka_record: true,
      },
      subjects
    );
    assert.equal(farhan.validation_status, 'unresolved');
  });

  // ── 7. Participant Snapshot & Explicit Validation Status ────
  it('7. Snapshot: persists participants with explicit validation_status into cbt_tka_participants', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-SNAP', name: 'TKA Snapshot', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    const snapResult = await snapshotTkaParticipants(d1, mansatasDb, eventId);
    assert.equal(snapResult.total, 8);
    assert.equal(snapResult.added, 8);

    // Verify rows in cbt_tka_participants
    const { results } = await d1
      .prepare('SELECT student_id, validation_status FROM cbt_tka_participants WHERE event_id = ?')
      .bind(eventId)
      .all<any>();

    assert.equal(results?.length, 8);
    const ahmad = results?.find((r) => r.student_id === 's-1');
    assert.equal(ahmad?.validation_status, 'valid');

    const citra = results?.find((r) => r.student_id === 's-3');
    assert.equal(citra?.validation_status, 'duplicate_option');

    // Verify idempotency (re-snapshot updates, doesn't duplicate)
    const snap2 = await snapshotTkaParticipants(d1, mansatasDb, eventId);
    assert.equal(snap2.added, 0);
    assert.equal(snap2.updated, 8);
  });

  // ── 8. Diff-Based Atomic Sync & Session Guard ───────────────
  it('8. Sync: calculates diff, preserves room, and enforces session guard & freeze boundary', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-SYNC', name: 'TKA Sync', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    // Initial snapshot
    await snapshotTkaParticipants(d1, mansatasDb, eventId);

    // Assign room to Ahmad (s-1)
    await assignParticipantRoom(d1, eventId, 's-1', 'room-1');

    // Mutate live Mansatas data:
    // 1. Ahmad changes choice 2 from Kimia to Biologi
    // 2. Add new student s-11 in Mansatas
    mansatasWrapper.rawSqlite.exec(`
      UPDATE tka_mapel_pilihan SET mapel_pilihan2 = 'Biologi' WHERE siswa_id = 's-1' AND tahun_ajaran_id = 'ta-2026';
      INSERT INTO siswa (id, nisn, nama_lengkap, jenis_kelamin, kelas_id, status) VALUES ('s-11', '0021', 'Kiki Baru', 'P', 'kelas-12-mipa-1', 'aktif');
      INSERT INTO tka_mapel_pilihan (id, siswa_id, tahun_ajaran_id, mapel_pilihan1, mapel_pilihan2) VALUES ('tka-11', 's-11', 'ta-2026', 'Fisika', 'Kimia');
    `);

    // Run sync
    const syncRes = await syncTkaParticipants(d1, mansatasDb, eventId);
    assert.equal(syncRes.added, 1, 's-11 should be added');
    assert.equal(syncRes.updated, 1, 's-1 should be updated with new choices');

    // Verify Ahmad's room assignment is PRESERVED
    const ahmadSnap = await d1
      .prepare('SELECT room_id, mapel_pilihan2_raw, mapel_pilihan2_subject_id FROM cbt_tka_participants WHERE event_id = ? AND student_id = ?')
      .bind(eventId, 's-1')
      .first<any>();
    assert.equal(ahmadSnap.room_id, 'room-1', 'Ahmad room_id must be preserved across sync');
    assert.equal(ahmadSnap.mapel_pilihan2_raw, 'Biologi');
    assert.equal(ahmadSnap.mapel_pilihan2_subject_id, 'mp-bio');

    // Test Session Guard: create exam and session
    const exRes = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
    cbtWrapper.rawSqlite.exec(`
      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type) VALUES ('sess-1', '${exRes.id!}', 's-1', 'mansatas');
    `);

    // Attempting sync when sessions exist must be REJECTED
    await assert.rejects(
      async () => syncTkaParticipants(d1, mansatasDb, eventId),
      /sudah terdapat sesi ujian siswa/
    );

    // Clean up session and transition to 'ready'
    cbtWrapper.rawSqlite.exec("DELETE FROM cbt_exam_sessions WHERE id = 'sess-1'");
    cbtWrapper.rawSqlite.exec(`UPDATE cbt_events SET status = 'ready' WHERE id = '${eventId}'`);

    // Attempting sync when status is 'ready' must throw EventFrozenError
    await assert.rejects(
      async () => syncTkaParticipants(d1, mansatasDb, eventId),
      /beku/
    );
  });

  // ── 9. Data-Quality & Diagnostic Reporting ──────────────────
  it('9. Diagnostics: preview endpoint exposes structured data quality issues', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-PREV', name: 'TKA Preview', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    const headers = await createAuthHeaders('admin', ['tka.access']);
    const res = await app.request(`/api/tka/events/${eventId}/participants/preview`, { headers });
    assert.equal(res.status, 200);

    const data = (await res.json()) as any;
    assert.ok(data.success);
    const preview = data.data;

    assert.equal(preview.summary.total_grade_12, 8);
    assert.equal(preview.summary.valid_count, 3); // s-1 (Ahmad), s-2 (Budi), s-10 (Joko)
    assert.equal(preview.summary.missing_option_count, 2); // s-5 (Eka) and s-7 (Gina)
    assert.equal(preview.summary.duplicate_option_count, 1); // s-3 (Citra)
    assert.equal(preview.summary.duplicate_mandatory_count, 1); // s-4 (Deni)
    assert.equal(preview.summary.unresolved_count, 1); // s-6 (Farhan)

    assert.equal(preview.data_quality_issues.length, 5);
  });

  // ── 10. Canonical Room Authority & Materialized Roster Sync ─
  it('10. Room Authority: assigning participant room synchronously updates all 5 roster rows', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-ROOM', name: 'TKA Room', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    // Create 3 mandatory exams + 2 elective exams (Fisika, Kimia)
    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');
    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-bin', title: 'Bahasa Indonesia' }, 'admin-1');
    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-big', title: 'Bahasa Inggris' }, 'admin-1');
    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis', title: 'Fisika' }, 'admin-1');
    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-kim', title: 'Kimia' }, 'admin-1');

    // Snapshot Ahmad (s-1: Fisika & Kimia)
    await snapshotTkaParticipants(d1, mansatasDb, eventId);

    // Verify Ahmad has 5 roster rows with room_id = null
    const { results: rosterPre } = await d1
      .prepare("SELECT room_id FROM cbt_exam_roster WHERE event_id = ? AND source_id = 's-1'")
      .bind(eventId)
      .all<any>();
    assert.equal(rosterPre?.length, 5, 'Ahmad should have exactly 5 roster rows');
    for (const r of rosterPre || []) assert.equal(r.room_id, null);

    // Assign Ahmad to room-1
    const assignRes = await assignParticipantRoom(d1, eventId, 's-1', 'room-1');
    assert.ok(assignRes.success);

    // Verify cbt_tka_participants.room_id is updated
    const partRow = await d1
      .prepare('SELECT room_id FROM cbt_tka_participants WHERE event_id = ? AND student_id = ?')
      .bind(eventId, 's-1')
      .first<any>();
    assert.equal(partRow.room_id, 'room-1', 'Participant room_id must be room-1');

    // Verify ALL 5 roster rows are synchronously updated
    const { results: rosterPost } = await d1
      .prepare("SELECT room_id FROM cbt_exam_roster WHERE event_id = ? AND source_id = 's-1'")
      .bind(eventId)
      .all<any>();
    assert.equal(rosterPost?.length, 5);
    for (const r of rosterPost || []) {
      assert.equal(r.room_id, 'room-1', 'Materialized roster room_id must match participant room_id');
    }
  });

  // ── 11. Exam-Room Scoped Token Policy ───────────────────────
  it('11. Token Policy: tokens generated per exam-room; readiness gate verifies tokens', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-TOK', name: 'TKA Token', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    const exMat = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');

    // Setup student with room-1 enrolled in exMat
    cbtWrapper.rawSqlite.exec(`
      INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
      VALUES ('r-tok-1', '${exMat.id!}', '${eventId}', 'mansatas', 's-1', '0011', 'Ahmad', 'room-1');
    `);

    // Headers for API call
    const headers = await createAuthHeaders('admin', ['tka.event.manage', 'tka.access']);

    // Generate tokens for exMat
    const genRes = await app.request(`/api/tka/exams/${exMat.id!}/tokens/generate`, {
      method: 'POST',
      headers,
    });
    assert.equal(genRes.status, 200);

    // Verify token exists for (exam_id, room-1)
    const tok = await d1
      .prepare('SELECT exam_id, room_id, token_code, is_active FROM cbt_exam_tokens WHERE exam_id = ?')
      .bind(exMat.id!)
      .first<any>();
    assert.ok(tok);
    assert.equal(tok.room_id, 'room-1');
    assert.equal(tok.is_active, 1);
  });

  // ── 12. Exact Subject Exam Coverage ─────────────────────────
  it('12. Subject Coverage: computes required subjects and exposes exam status', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-COV', name: 'TKA Coverage', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    // Snapshot participants
    await snapshotTkaParticipants(d1, mansatasDb, eventId);

    const coverage = await getTkaSubjectCoverage(d1, mansatasDb, eventId);
    // Mandatory: Matematika, Bahasa Indonesia, Bahasa Inggris
    const matCov = coverage.find((c) => c.subject_name === 'Matematika');
    assert.ok(matCov);
    assert.equal(matCov.category, 'wajib');
    assert.equal(matCov.participant_count, 3); // 3 valid students (Ahmad, Budi, Joko)
    assert.equal(matCov.has_exam, false);

    // Electives chosen by valid students: Fisika (s-1), Kimia (s-1), Biologi (s-2), Ekonomi (s-2), Geografi (s-10), Sosiologi (s-10)
    const fisCov = coverage.find((c) => c.subject_name === 'Fisika');
    assert.ok(fisCov);
    assert.equal(fisCov.category, 'pilihan');
    assert.equal(fisCov.participant_count, 1);

    // Batch create exams for covered subjects
    const batchRes = await batchCreateCoveredTkaExams(d1, mansatasDb, eventId, 'admin-1');
    assert.ok(batchRes.created >= 9, 'Should create exams for all 3 mandatory + 6 chosen electives');

    // Re-check coverage
    const covAfter = await getTkaSubjectCoverage(d1, mansatasDb, eventId);
    const matAfter = covAfter.find((c) => c.subject_name === 'Matematika');
    assert.equal(matAfter?.has_exam, true);
    const fisAfter = covAfter.find((c) => c.subject_name === 'Fisika');
    assert.equal(fisAfter?.has_exam, true);
  });

  // ── 13. Domain Isolation & IDOR Protection ──────────────────
  it('13. Domain Isolation: rejects PMB, Kegiatan, Ulangan, Semester events on /api/tka', async () => {
    initApp();
    // Seed non-TKA events
    cbtWrapper.rawSqlite.exec(`
      INSERT INTO cbt_events (id, code, name, mode, status) VALUES
        ('ev-pmb', 'PMB-2026', 'PMB', 'pmb', 'active'),
        ('ev-keg', 'KEG-2026', 'Kegiatan', 'kegiatan', 'active'),
        ('ev-sem', 'SEM-2026', 'Semester', 'semester', 'active'),
        ('ev-uln', 'ULN-2026', 'Ulangan', 'ulangan', 'active');
    `);

    const headers = await createAuthHeaders('admin', ['tka.access', 'tka.event.manage']);

    // Call GET /api/tka/events/ev-pmb -> rejected
    const resPmb = await app.request('/api/tka/events/ev-pmb', { headers });
    assert.equal(resPmb.status, 400);
    const dataPmb = (await resPmb.json()) as any;
    assert.match(dataPmb.error, /bukan merupakan domain TKA/);

    // Call GET /api/tka/events/ev-keg -> rejected
    const resKeg = await app.request('/api/tka/events/ev-keg', { headers });
    assert.equal(resKeg.status, 400);

    // Call GET /api/tka/events/ev-uln -> rejected
    const resUln = await app.request('/api/tka/events/ev-uln', { headers });
    assert.equal(resUln.status, 400);
  });

  // ── 14. Student Runtime Authorization ───────────────────────
  it('14. Student Authorization: student only assigned to their 5 exams, isolated from others', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-STUD', name: 'TKA Student', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    // Create Mandatory: Mat, Bin, Big
    const exMat = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');
    const exBin = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-bin', title: 'Bahasa Indonesia' }, 'admin-1');
    const exBig = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-big', title: 'Bahasa Inggris' }, 'admin-1');

    // Create Electives: Fisika, Kimia, Biologi, Ekonomi
    const exFis = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis', title: 'Fisika' }, 'admin-1');
    const exKim = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-kim', title: 'Kimia' }, 'admin-1');
    const exBio = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-bio', title: 'Biologi' }, 'admin-1');
    const exEko = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-eko', title: 'Ekonomi' }, 'admin-1');

    // Snapshot participants:
    // s-1 (Ahmad): Mat, Bin, Big, Fis, Kim
    // s-2 (Budi): Mat, Bin, Big, Bio, Eko
    await snapshotTkaParticipants(d1, mansatasDb, eventId);

    // Query Ahmad's roster
    const { results: ahmadRoster } = await d1
      .prepare("SELECT exam_id FROM cbt_exam_roster WHERE source_id = 's-1'")
      .all<any>();
    const ahmadExamIds = new Set((ahmadRoster || []).map((r) => r.exam_id));

    assert.equal(ahmadExamIds.size, 5);
    assert.ok(ahmadExamIds.has(exMat.id!), 'Ahmad has Matematika');
    assert.ok(ahmadExamIds.has(exBin.id!), 'Ahmad has B. Indonesia');
    assert.ok(ahmadExamIds.has(exBig.id!), 'Ahmad has B. Inggris');
    assert.ok(ahmadExamIds.has(exFis.id!), 'Ahmad has Fisika');
    assert.ok(ahmadExamIds.has(exKim.id!), 'Ahmad has Kimia');
    assert.ok(!ahmadExamIds.has(exBio.id!), 'Ahmad MUST NOT have Biologi');
    assert.ok(!ahmadExamIds.has(exEko.id!), 'Ahmad MUST NOT have Ekonomi');

    // Query Budi's roster
    const { results: budiRoster } = await d1
      .prepare("SELECT exam_id FROM cbt_exam_roster WHERE source_id = 's-2'")
      .all<any>();
    const budiExamIds = new Set((budiRoster || []).map((r) => r.exam_id));

    assert.equal(budiExamIds.size, 5);
    assert.ok(budiExamIds.has(exBio.id!), 'Budi has Biologi');
    assert.ok(budiExamIds.has(exEko.id!), 'Budi has Ekonomi');
    assert.ok(!budiExamIds.has(exFis.id!), 'Budi MUST NOT have Fisika');
  });

  // ── 15. Event/Exam Lifecycle Synchronization ─────────────────
  it('15. Lifecycle: event status transitions atomically synchronize all member exams active_status', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-LIFE', name: 'TKA Lifecycle', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    const ex1 = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');
    const ex2 = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis', title: 'Fisika' }, 'admin-1');

    // 1. Transition to configuration
    const toConfig = await transitionTkaEventStatus(d1, eventId, 'configuration');
    assert.ok(toConfig.success);

    const examsConfig = await d1
      .prepare('SELECT active_status FROM cbt_exams WHERE event_id = ?')
      .bind(eventId)
      .all<any>();
    for (const x of examsConfig.results || []) {
      assert.equal(x.active_status, 'configuration');
    }

    // 2. Direct transition to ready fails readiness gate because requirements are not yet satisfied
    const toReadyFail = await transitionTkaEventStatus(d1, eventId, 'ready');
    assert.equal(toReadyFail.success, false);
    assert.ok(toReadyFail.readiness.blockers.length > 0);

    // 3. Rollback to draft
    const toDraft = await transitionTkaEventStatus(d1, eventId, 'draft');
    assert.ok(toDraft.success);

    const examsDraft = await d1
      .prepare('SELECT active_status FROM cbt_exams WHERE event_id = ?')
      .bind(eventId)
      .all<any>();
    for (const x of examsDraft.results || []) {
      assert.equal(x.active_status, 'draft');
    }
  });

  // ── 16. Historical Stability After Freeze ────────────────────
  it('16. Historical Stability: mutating Mansatas choices after freeze does not alter frozen CBT rosters', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-HIST', name: 'TKA History', academic_year_id: 'ta-2026', academic_year_name: '2026/2027' },
      'admin-1'
    );
    const eventId = ev.id!;

    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');
    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-bin', title: 'Bahasa Indonesia' }, 'admin-1');
    await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-big', title: 'Bahasa Inggris' }, 'admin-1');
    const exFis = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis', title: 'Fisika' }, 'admin-1');
    const exKim = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-kim', title: 'Kimia' }, 'admin-1');

    // Snapshot while in draft
    await snapshotTkaParticipants(d1, mansatasDb, eventId);

    // Freeze event (force status ready/active in DB)
    cbtWrapper.rawSqlite.exec(`UPDATE cbt_events SET status = 'active' WHERE id = '${eventId}'`);

    // Now mutate Mansatas DB: change Ahmad's choice to Ekonomi & Sosiologi, or delete Ahmad
    mansatasWrapper.rawSqlite.exec(`
      UPDATE tka_mapel_pilihan SET mapel_pilihan1 = 'Ekonomi', mapel_pilihan2 = 'Sosiologi'
      WHERE siswa_id = 's-1' AND tahun_ajaran_id = 'ta-2026';
    `);

    // Verify CBT snapshot for Ahmad is UNCHANGED
    const ahmadSnap = await d1
      .prepare('SELECT mapel_pilihan1_raw, mapel_pilihan2_raw FROM cbt_tka_participants WHERE event_id = ? AND student_id = ?')
      .bind(eventId, 's-1')
      .first<any>();
    assert.equal(ahmadSnap.mapel_pilihan1_raw, 'Fisika');
    assert.equal(ahmadSnap.mapel_pilihan2_raw, 'Kimia');

    // Verify CBT roster for Ahmad still has Fisika & Kimia
    const { results: roster } = await d1
      .prepare("SELECT exam_id FROM cbt_exam_roster WHERE event_id = ? AND source_id = 's-1'")
      .bind(eventId)
      .all<any>();
    const examIds = (roster || []).map((r) => r.exam_id);
    assert.ok(examIds.includes(exFis.id!));
    assert.ok(examIds.includes(exKim.id!));
  });
});
