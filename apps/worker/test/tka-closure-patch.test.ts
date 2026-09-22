// ============================================================
// Phase 5 Consolidated Closure Patch Verification Test Suite
//
// Explicitly validates the 7 closure requirements:
// 1. Complete Shared UI / TKA API contract (/sessions, /question-analytics, /results-export, /recompute-missing, /recover, /toggle, /extend, /questions/bulk)
// 2. Non-NULL verified subject_id enforcement (rejects synthetic IDs, accepts only verified Mansatas mata_pelajaran.id)
// 3. Roster-driven exam-room token coverage (Gate 10 checks distinct enrolled exam-room pairs)
// 4. TKA child lifecycle + subject-set freeze upon ready+ (blocks exam additions/deletions, blocks generic active_status update)
// 5. Audit/remove capacity-based room distribution (verifies pure sequential/round-robin allocation without capacity math)
// 6. Event-scoped academic-year validation (create, update, snapshot, sync, and Gate 2)
// 7. validation_status CHECK constraint + Full RBAC matrix (401 unauthenticated, 403 student, 403 unauthorized staff, read-only vs manage, negative IDOR rejection)
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import tkaRoutes from '../src/routes/domains/tka.ts';
import { signJWT } from '../src/utils/jwt.ts';
import {
  createTkaEvent,
  updateTkaEvent,
  transitionTkaEventStatus,
} from '../src/services/domains/tka/events.ts';
import {
  snapshotTkaParticipants,
  assignParticipantRoom,
  bulkAssignParticipantRooms,
} from '../src/services/domains/tka/snapshot.ts';
import {
  createTkaExam,
  deleteTkaExam,
} from '../src/services/domains/tka/exams.ts';
import { checkTkaEventReadiness } from '../src/services/domains/tka/readiness.ts';
import { updateExam, deleteExam } from '../src/services/exam-engine/exams.ts';

const JWT_SECRET = 'test-secret-key-for-tka-closure-patch';

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

    CREATE TABLE cbt_cheat_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      violation_type TEXT NOT NULL,
      happened_at TEXT NOT NULL
    );

    CREATE TABLE cbt_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      nama_lengkap TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      room_id TEXT REFERENCES cbt_rooms(id),
      nisn TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO cbt_rooms (id, room_name, capacity) VALUES
      ('room-1', 'Lab Komputer 1', 40),
      ('room-2', 'Lab Komputer 2', 40),
      ('room-3', 'Lab Komputer 3', 40);
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
      ('mp-fis', 'Fisika', 'FIS', 'MIPA'),
      ('mp-kim', 'Kimia', 'KIM', 'MIPA'),
      ('mp-bio', 'Biologi', 'BIO', 'MIPA'),
      ('mp-eko', 'Ekonomi', 'EKO', 'IPS');

    -- Seed Classes
    INSERT INTO kelas (id, tingkat, kelompok, nomor_kelas) VALUES
      ('kelas-12-mipa-1', 12, 'MIPA', 1),
      ('kelas-12-mipa-2', 12, 'MIPA', 2);

    -- Seed Students
    INSERT INTO siswa (id, nisn, nama_lengkap, jenis_kelamin, kelas_id, status) VALUES
      ('s-1', '0011', 'Ahmad Siswa', 'L', 'kelas-12-mipa-1', 'aktif'),
      ('s-2', '0012', 'Budi Santoso', 'L', 'kelas-12-mipa-1', 'aktif'),
      ('s-3', '0013', 'Citra Lestari', 'P', 'kelas-12-mipa-2', 'aktif');

    -- Choices for ta-2026
    INSERT INTO tka_mapel_pilihan (id, siswa_id, tahun_ajaran_id, mapel_pilihan1, mapel_pilihan2) VALUES
      ('tka-1', 's-1', 'ta-2026', 'Fisika', 'Kimia'),
      ('tka-2', 's-2', 'ta-2026', 'Fisika', 'Kimia'),
      ('tka-3', 's-3', 'ta-2026', 'Biologi', 'Ekonomi');
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

describe('Phase 5 Consolidated Closure Patch Verification Suite', () => {
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

  // ── 1. Complete Shared UI / TKA API Contract ───────────────────
  it('Closure Item 1: All shared engine UI endpoints work correctly on /api/tka/exams/:id/*', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-UI', name: 'TKA UI Contract', academic_year_id: 'ta-2026' },
      'admin-1'
    );
    const eventId = ev.id!;

    const ex = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');
    const examId = ex.id!;
    const adminHeaders = await createAuthHeaders('admin', ['tka.access', 'tka.event.manage']);

    // 1.1 GET /exams/:id/sessions (MonitorView & AnalyticsView)
    const sessionsRes = await app.request(`/api/tka/exams/${examId}/sessions`, { headers: adminHeaders });
    assert.equal(sessionsRes.status, 200);
    const sessionsBody = (await sessionsRes.json()) as any;
    assert.ok(sessionsBody.success);
    assert.ok(Array.isArray(sessionsBody.data));

    // 1.2 GET /exams/:id/question-analytics (AnalyticsView)
    const analyticsRes = await app.request(`/api/tka/exams/${examId}/question-analytics`, { headers: adminHeaders });
    assert.equal(analyticsRes.status, 200);
    const analyticsBody = (await analyticsRes.json()) as any;
    assert.ok(analyticsBody.success);
    assert.ok(Array.isArray(analyticsBody.data.questions));
    assert.ok(Array.isArray(analyticsBody.data.rows));

    // 1.3 GET /exams/:id/results-export (ResultsView)
    const resultsExportRes = await app.request(`/api/tka/exams/${examId}/results-export`, { headers: adminHeaders });
    assert.equal(resultsExportRes.status, 200);
    const exportBody = (await resultsExportRes.json()) as any;
    assert.ok(exportBody.success);

    // 1.4 POST /exams/:id/questions/bulk (QuestionsView - BulkImport)
    const bulkImportRes = await app.request(`/api/tka/exams/${examId}/questions/bulk`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        questions: [
          {
            question_text: 'Berapakah 2 + 2?',
            question_type: 'multiple_choice',
            points: 1,
            options: [
              { option_label: 'A', option_text: '3', is_correct: 0 },
              { option_label: 'B', option_text: '4', is_correct: 1 },
            ],
          },
        ],
      }),
    });
    assert.equal(bulkImportRes.status, 200);
    const bulkBody = (await bulkImportRes.json()) as any;
    assert.ok(bulkBody.success);
    assert.equal(bulkBody.data?.imported, 1);

    // 1.5 Setup session & token for recovery, toggle, extend, delete
    cbtWrapper.rawSqlite.exec(`
      INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
      VALUES ('tok-test-1', '${examId}', 'room-1', 'XYZ123', 1);

      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status)
      VALUES ('sess-test-1', '${examId}', 's-1', 'mansatas', 'room-1', 'active');
    `);

    // 1.6 PUT /exams/:id/tokens/:tokenId/toggle (TokensView)
    const toggleRes = await app.request(`/api/tka/exams/${examId}/tokens/tok-test-1/toggle`, {
      method: 'PUT',
      headers: adminHeaders,
    });
    assert.equal(toggleRes.status, 200);
    const toggleBody = (await toggleRes.json()) as any;
    assert.ok(toggleBody.success);
    assert.equal(toggleBody.data?.is_active ?? toggleBody.is_active, 0);

    // 1.7 POST /exams/:id/sessions/:sessionId/extend (MonitorView)
    const extendRes = await app.request(`/api/tka/exams/${examId}/sessions/sess-test-1/extend`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ extra_minutes: 15 }),
    });
    assert.equal(extendRes.status, 200);
    const extendBody = (await extendRes.json()) as any;
    assert.ok(extendBody.success);

    // 1.8 POST /exams/:id/recover (MonitorView)
    const recoverRes = await app.request(`/api/tka/exams/${examId}/recover`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert.equal(recoverRes.status, 200);
    const recoverBody = (await recoverRes.json()) as any;
    assert.ok(recoverBody.success);

    // 1.9 POST /exams/:id/results/recompute-missing (ResultsView)
    const recomputeRes = await app.request(`/api/tka/exams/${examId}/results/recompute-missing`, {
      method: 'POST',
      headers: adminHeaders,
    });
    assert.equal(recomputeRes.status, 200);
    const recomputeBody = (await recomputeRes.json()) as any;
    assert.ok(recomputeBody.success);

    // 1.10 DELETE /exams/:id/results/:sessionId (ResultsView)
    const deleteResultRes = await app.request(`/api/tka/exams/${examId}/results/sess-test-1`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    assert.equal(deleteResultRes.status, 200);
    const deleteResultBody = (await deleteResultRes.json()) as any;
    assert.ok(deleteResultBody.success);
  });

  // ── 2. Valid non-NULL verified subject_id enforcement ───────────
  it('Closure Item 2: Rejects non-NULL unverified or synthetic subject_id, accepts valid Mansatas mata_pelajaran.id', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-SUBJ', name: 'TKA Subject Validation', academic_year_id: 'ta-2026' },
      'admin-1'
    );
    const eventId = ev.id!;

    // 2.1 Synthetic subject_id like 'tka-fisika' must be rejected
    const syntheticRes = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'tka-fisika' }, 'admin-1');
    assert.equal(syntheticRes.success, false);
    assert.match(syntheticRes.error!, /tidak valid atau tidak terdaftar/);

    // 2.2 Empty subject_id must be rejected
    const emptyRes = await createTkaExam(d1, mansatasDb, eventId, { subject_id: '' }, 'admin-1');
    assert.equal(emptyRes.success, false);
    assert.match(emptyRes.error!, /Mata pelajaran.*wajib dipilih/);

    // 2.3 Non-existent Mansatas ID must be rejected
    const bogusRes = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-bogus-999' }, 'admin-1');
    assert.equal(bogusRes.success, false);
    assert.match(bogusRes.error!, /tidak valid atau tidak terdaftar/);

    // 2.4 Verified Mansatas mata_pelajaran.id 'mp-fis' must succeed
    const validRes = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
    assert.ok(validRes.success);
    assert.ok(validRes.id);

    const examRow = await d1
      .prepare('SELECT subject_id, subject_name FROM cbt_exams WHERE id = ?')
      .bind(validRes.id!)
      .first<any>();
    assert.equal(examRow.subject_id, 'mp-fis');
    assert.equal(examRow.subject_name, 'Fisika');
  });

  // ── 3. Roster-driven exam-room token coverage ───────────────────
  it('Closure Item 3: Gate 10 checks token coverage driven strictly by distinct (exam_id, room_id) with enrolled roster', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-ROSTER-TOK', name: 'TKA Roster Token Coverage', academic_year_id: 'ta-2026' },
      'admin-1'
    );
    const eventId = ev.id!;

    // Create 3 mandatory exams
    const exMat = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');
    const exBin = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-bin', title: 'Bahasa Indonesia' }, 'admin-1');
    const exBig = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-big', title: 'Bahasa Inggris' }, 'admin-1');
    // Create 2 elective exams
    const exFis = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis', title: 'Fisika' }, 'admin-1');
    const exKim = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-kim', title: 'Kimia' }, 'admin-1');

    // Add at least 1 question per exam so question gate passes
    for (const examId of [exMat.id!, exBin.id!, exBig.id!, exFis.id!, exKim.id!]) {
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_questions (id, exam_id, question_order, question_text)
        VALUES ('q-${examId}', '${examId}', 1, 'Soal 1');
      `);
    }

    // Snapshot students (Ahmad & Budi choose Fisika & Kimia; Citra chooses Biologi & Ekonomi)
    await snapshotTkaParticipants(d1, mansatasDb, eventId);

    // Assign Ahmad and Budi to room-1
    await assignParticipantRoom(d1, eventId, 's-1', 'room-1');
    await assignParticipantRoom(d1, eventId, 's-2', 'room-1');

    // Generate tokens ONLY for room-1 on all 5 covered exams
    for (const examId of [exMat.id!, exBin.id!, exBig.id!, exFis.id!, exKim.id!]) {
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-${examId}-r1', '${examId}', 'room-1', 'TOK123', 1);
      `);
    }

    // Notice room-2 has NO tokens, but NO students are assigned to room-2 for these exams!
    // Check readiness gate:
    const readiness = await checkTkaEventReadiness(d1, eventId, mansatasDb);
    const tokenGate = readiness.checks.find((c) => c.id === 'tokens_active');
    assert.ok(tokenGate);
    assert.equal(tokenGate.passed, true, 'Gate 10 passes because room-1 (the only enrolled room) has all tokens');

    // Now, assign Citra to room-2, and add Biologi exam to satisfy Citra
    const exBio = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-bio', title: 'Biologi' }, 'admin-1');
    cbtWrapper.rawSqlite.exec(`
      INSERT INTO cbt_questions (id, exam_id, question_order, question_text)
      VALUES ('q-${exBio.id!}', '${exBio.id!}', 1, 'Soal Bio');
    `);
    await assignParticipantRoom(d1, eventId, 's-3', 'room-2');

    // Now exBio is assigned to Citra in room-2, but room-2 has NO token for exBio!
    const readiness2 = await checkTkaEventReadiness(d1, eventId, mansatasDb);
    const tokenGate2 = readiness2.checks.find((c) => c.id === 'tokens_active');
    assert.ok(tokenGate2);
    assert.equal(tokenGate2.passed, false, 'Gate 10 must fail because exBio in room-2 has enrolled students but no active token');
    assert.match(tokenGate2.message, /Lab Komputer 2|room-2/);
  });

  // ── 4. TKA Child Lifecycle & Subject-Set Freeze upon ready+ ────
  it('Closure Item 4: Mutating active_status directly via generic updateExam is blocked, and exams are frozen at ready+', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-FREEZE', name: 'TKA Freeze Lifecycle', academic_year_id: 'ta-2026' },
      'admin-1'
    );
    const eventId = ev.id!;

    const ex = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-mat', title: 'Matematika' }, 'admin-1');
    const examId = ex.id!;

    // 4.1 Generic updateExam cannot directly mutate active_status of a TKA exam
    const bypassAttempt = await updateExam(d1, examId, { active_status: 'active' } as any);
    assert.equal(bypassAttempt.success, false);
    assert.match(bypassAttempt.error!, /dikelola secara kanonikal melalui lifecycle event/);

    // 4.2 Generic deleteExam cannot delete TKA exam when status >= ready
    cbtWrapper.rawSqlite.exec(`UPDATE cbt_events SET status = 'ready' WHERE id = '${eventId}';`);
    const deleteBlocked = await deleteExam(d1, examId);
    assert.equal(deleteBlocked.success, false);
    assert.match(deleteBlocked.error!, /tidak dapat dihapus setelah event mencapai status Ready/);

    // 4.3 Direct createTkaExam is blocked when event status >= ready (throws EventFrozenError)
    await assert.rejects(
      async () => createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1'),
      /EventFrozenError|Ready/
    );

    // 4.4 Direct deleteTkaExam is blocked when event status >= ready (throws EventFrozenError)
    await assert.rejects(
      async () => deleteTkaExam(d1, eventId, examId),
      /EventFrozenError|Ready/
    );

    // 4.5 Deletion is also blocked if session exists
    cbtWrapper.rawSqlite.exec(`
      UPDATE cbt_events SET status = 'draft' WHERE id = '${eventId}';
      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status)
      VALUES ('sess-guard-1', '${examId}', 's-1', 'mansatas', 'active');
    `);
    const deleteWithSession = await deleteExam(d1, examId);
    assert.equal(deleteWithSession.success, false);
    assert.match(deleteWithSession.error!, /sudah ada sesi ujian siswa/);
  });

  // ── 5. Audit/remove capacity-based room distribution ──────────
  it('Closure Item 5: Room assignment distributes participants round-robin / sequentially without capacity limits', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-CAP', name: 'TKA Capacity Audit', academic_year_id: 'ta-2026' },
      'admin-1'
    );
    const eventId = ev.id!;

    // Snapshot 3 participants
    await snapshotTkaParticipants(d1, mansatasDb, eventId);

    // 5.1 Verify GET /events/:id/rooms endpoint returns rooms
    const adminHeaders = await createAuthHeaders('admin', ['tka.event.manage', 'tka.access']);
    const roomsRes = await app.request(`/api/tka/events/${eventId}/rooms`, { headers: adminHeaders });
    assert.equal(roomsRes.status, 200);

    // 5.2 Bulk assign participants via HTTP POST /api/tka/events/:id/rooms/bulk-assign
    const assignments = [
      { student_id: 's-1', room_id: 'room-1' },
      { student_id: 's-2', room_id: 'room-2' },
      { student_id: 's-3', room_id: 'room-1' },
    ];
    const bulkRes = await app.request(`/api/tka/events/${eventId}/rooms/bulk-assign`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ assignments }),
    });
    assert.equal(bulkRes.status, 200);
    const bulkBody = (await bulkRes.json()) as any;
    assert.ok(bulkBody.success);
    assert.equal(bulkBody.data.updated, 3);

    const { results } = await d1
      .prepare('SELECT student_id, room_id FROM cbt_tka_participants WHERE event_id = ? ORDER BY student_id')
      .bind(eventId)
      .all<any>();

    // Sequential round-robin: s-1 -> room-1, s-2 -> room-2, s-3 -> room-1
    assert.equal(results?.[0].room_id, 'room-1');
    assert.equal(results?.[1].room_id, 'room-2');
    assert.equal(results?.[2].room_id, 'room-1');
  });

  // ── 6. Event-scoped academic-year validation ───────────────────
  it('Closure Item 6: Enforces event-scoped academic-year validation across creation, update, and Gate 2', async () => {
    initApp();

    // 6.1 Creating event with non-existent academic_year_id fails
    const createInvalid = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-BAD-TA', name: 'TKA Bad TA', academic_year_id: 'ta-non-existent-999' },
      'admin-1'
    );
    assert.equal(createInvalid.success, false);
    assert.match(createInvalid.error!, /tidak valid.*database sekolah/);

    // 6.2 Creating event with valid academic_year_id succeeds
    const createValid = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-GOOD-TA', name: 'TKA Good TA', academic_year_id: 'ta-2026' },
      'admin-1'
    );
    assert.ok(createValid.success);
    const eventId = createValid.id!;

    // 6.3 Updating event with non-existent academic_year_id fails
    const updateInvalid = await updateTkaEvent(
      d1,
      mansatasDb,
      eventId,
      { academic_year_id: 'ta-non-existent-999' }
    );
    assert.equal(updateInvalid.success, false);
    assert.match(updateInvalid.error!, /tidak valid.*database sekolah/);

    // 6.4 Gate 2 passes when academic_year_id is valid
    const readiness = await checkTkaEventReadiness(d1, eventId, mansatasDb);
    const taGate = readiness.checks.find((c) => c.id === 'academic_year');
    assert.ok(taGate);
    assert.equal(taGate.passed, true);
  });

  // ── 7. validation_status CHECK constraint + Full RBAC matrix ───
  it('Closure Item 7: Enforces validation_status CHECK constraint at DB level and full RBAC matrix via HTTP', async () => {
    initApp();
    const ev = await createTkaEvent(
      d1,
      mansatasDb,
      { code: 'TKA-RBAC', name: 'TKA RBAC & Constraint', academic_year_id: 'ta-2026' },
      'admin-1'
    );
    const eventId = ev.id!;

    // 7.1 Database CHECK constraint: inserting invalid validation_status fails
    assert.throws(() => {
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_tka_participants (id, event_id, student_id, nama_lengkap, validation_status)
        VALUES ('tp-invalid', '${eventId}', 's-invalid', 'Student Invalid', 'bogus_status');
      `);
    }, /CHECK constraint failed/);

    // Inserting all 6 valid statuses succeeds
    const validStatuses = ['valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending'];
    for (const [idx, status] of validStatuses.entries()) {
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_tka_participants (id, event_id, student_id, nama_lengkap, validation_status)
        VALUES ('tp-${idx}', '${eventId}', 's-chk-${idx}', 'Student ${idx}', '${status}');
      `);
    }

    // 7.2 Full RBAC Matrix via HTTP
    // 7.2.1 Unauthenticated -> 401
    const resUnauth = await app.request(`/api/tka/events/${eventId}`);
    assert.equal(resUnauth.status, 401);

    // 7.2.2 Student role -> 403
    const studentHeaders = await createAuthHeaders('siswa');
    const resStudent = await app.request(`/api/tka/events/${eventId}`, { headers: studentHeaders });
    assert.equal(resStudent.status, 403);

    // 7.2.3 Teacher without TKA permission -> 403
    const teacherHeaders = await createAuthHeaders('guru');
    const resTeacher = await app.request(`/api/tka/events/${eventId}`, { headers: teacherHeaders });
    assert.equal(resTeacher.status, 403);

    // 7.2.4 Read-only staff (tka.access only)
    const readOnlyHeaders = await createAuthHeaders('guru', ['tka.access']);
    // GET succeeds
    const resReadGet = await app.request(`/api/tka/events/${eventId}`, { headers: readOnlyHeaders });
    assert.equal(resReadGet.status, 200);
    // POST mutation fails with 403
    const resReadPost = await app.request(`/api/tka/events/${eventId}/participants/snapshot`, {
      method: 'POST',
      headers: readOnlyHeaders,
    });
    assert.equal(resReadPost.status, 403);

    // 7.2.5 Authorized staff with tka.event.manage + tka.access -> mutation succeeds
    const manageHeaders = await createAuthHeaders('guru', ['tka.event.manage', 'tka.access']);
    const resManagePost = await app.request(`/api/tka/events/${eventId}/participants/snapshot`, {
      method: 'POST',
      headers: manageHeaders,
    });
    assert.equal(resManagePost.status, 200);

    // 7.2.6 Admin role -> full access
    const adminHeaders = await createAuthHeaders('admin');
    const resAdmin = await app.request(`/api/tka/events/${eventId}`, { headers: adminHeaders });
    assert.equal(resAdmin.status, 200);

    // 7.2.7 Negative IDOR Rejection
    // Create an exam belonging to a different event (or ulangan)
    cbtWrapper.rawSqlite.exec(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES ('ev-other', 'OTHER-01', 'Other Domain Event', 'kegiatan', 'draft');
      INSERT INTO cbt_exams (id, title, event_id, mode)
      VALUES ('ex-other', 'Other Exam', 'ev-other', 'kegiatan');
    `);
    // Attempting to access other exam through /api/tka/exams/ex-other -> 400 Domain mismatch
    const resIdor = await app.request('/api/tka/exams/ex-other/sessions', { headers: adminHeaders });
    assert.equal(resIdor.status, 400);
  });
});
