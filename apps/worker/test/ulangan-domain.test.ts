// test/ulangan-domain.test.ts
// Comprehensive Integration Test Suite for Phase 4 — Ulangan Harian Domain

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import ulanganRoutes from '../src/routes/domains/ulangan.ts';
import studentRoutes from '../src/routes/student.ts';
import { signJWT } from '../src/utils/jwt.ts';
import {
  listTeacherAssignments,
  getTeachingAssignmentById,
  listActiveStudentsInClass,
} from '../src/services/sources/teaching-assignments.ts';
import {
  createUlanganExam,
  listUlanganExams,
  getUlanganExamDetail,
  updateUlanganExam,
  deleteUlanganExam,
  transitionUlanganStatus,
  assertUlanganOwnership,
} from '../src/services/domains/ulangan/exams.ts';
import { checkUlanganReadiness } from '../src/services/domains/ulangan/readiness.ts';
import {
  snapshotWholeClassRoster,
  listUlanganRoster,
  clearUlanganRoster,
} from '../src/services/domains/ulangan/roster.ts';
import { isRoomRequiredForExam, validateEventTransition } from '../src/services/platform/event-lifecycle.ts';
import { generateExamTokens } from '../src/services/exam-engine/tokens.ts';
import { createExam, updateExam } from '../src/services/exam-engine/exams.ts';

// Helper to create test D1 database matching CBT schema with Phase 4 additions
function createTestD1Database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE cbt_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nama_lengkap TEXT NOT NULL,
      role TEXT NOT NULL,
      room_id TEXT,
      nisn TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_staff_profiles (
      id TEXT PRIMARY KEY,
      mansatas_user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      nama_lengkap TEXT NOT NULL,
      nip TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_role_assignments (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'proctor')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(staff_id, role)
    );

    CREATE TABLE cbt_permission_grants (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES cbt_staff_profiles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_value TEXT NOT NULL DEFAULT '*',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(staff_id, permission, scope_type, scope_value)
    );

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
      room_name TEXT NOT NULL UNIQUE,
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
      subject_name TEXT,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      cheat_limit INTEGER DEFAULT 3,
      cheat_action TEXT DEFAULT 'lock',
      enforce_fullscreen INTEGER DEFAULT 0,
      mode TEXT CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      owner_staff_id TEXT,
      version_label TEXT,
      is_frozen INTEGER DEFAULT 0,
      teaching_assignment_id TEXT,
      subject_id TEXT,
      class_id TEXT,
      class_name TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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

    CREATE TABLE cbt_exam_assignments (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, user_id, user_type)
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
      room_id TEXT,
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
      device_id TEXT,
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

    CREATE TABLE cbt_cheat_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
      violation_type TEXT NOT NULL,
      happened_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cbt_exams_ulangan_event_unique
    ON cbt_exams(event_id)
    WHERE mode = 'ulangan';
  `);

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
        ...exec([]),
        bind: (...params: any[]) => exec(params),
      };
    },
    batch: async (statements: any[]) => {
      const results = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    },
  };

  return { sqlite, d1 };
}

// Helper to create mock MANSATAS_DB with authoritative teaching schema
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
      kode_mapel TEXT NOT NULL,
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

    CREATE TABLE penugasan_mengajar (
      id TEXT PRIMARY KEY,
      guru_id TEXT NOT NULL,
      tahun_ajaran_id TEXT NOT NULL REFERENCES tahun_ajaran(id),
      mapel_id TEXT NOT NULL REFERENCES mata_pelajaran(id),
      kelas_id TEXT NOT NULL REFERENCES kelas(id)
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

    -- Seed Academic Year
    INSERT INTO tahun_ajaran (id, nama, semester, is_active) VALUES
      ('ta-2026', '2026/2027', '1', 1);

    -- Seed Subjects
    INSERT INTO mata_pelajaran (id, nama_mapel, kode_mapel, kelompok) VALUES
      ('mapel-mat', 'Matematika Peminatan', 'MAT-PEM', 'MIPA'),
      ('mapel-bio', 'Biologi', 'BIO', 'MIPA'),
      ('mapel-fis', 'Fisika', 'FIS', 'MIPA');

    -- Seed Classes
    INSERT INTO kelas (id, tingkat, kelompok, nomor_kelas) VALUES
      ('kelas-12-mipa-1', 12, 'MIPA', 1),
      ('kelas-12-mipa-2', 12, 'MIPA', 2),
      ('kelas-11-mipa-1', 11, 'MIPA', 1);

    -- Seed Teaching Assignments:
    -- Guru A (user-guru-a): Teaches Matematika in 12 MIPA 1 and 12 MIPA 2
    -- Guru B (user-guru-b): Teaches Biologi in 12 MIPA 1
    INSERT INTO penugasan_mengajar (id, guru_id, tahun_ajaran_id, mapel_id, kelas_id) VALUES
      ('assign-a1', 'user-guru-a', 'ta-2026', 'mapel-mat', 'kelas-12-mipa-1'),
      ('assign-a2', 'user-guru-a', 'ta-2026', 'mapel-mat', 'kelas-12-mipa-2'),
      ('assign-b1', 'user-guru-b', 'ta-2026', 'mapel-bio', 'kelas-12-mipa-1');

    -- Seed Students
    INSERT INTO siswa (id, nisn, nis_lokal, nama_lengkap, jenis_kelamin, kelas_id, status) VALUES
      ('s-1', '0012345671', '26001', 'Ahmad Dahlan', 'L', 'kelas-12-mipa-1', 'aktif'),
      ('s-2', '0012345672', '26002', 'Budi Santoso', 'L', 'kelas-12-mipa-1', 'aktif'),
      ('s-3', '0012345673', '26003', 'Citra Lestari', 'P', 'kelas-12-mipa-1', 'aktif'),
      ('s-4', '0012345674', '26004', 'Deni Ramdani', 'L', 'kelas-12-mipa-1', 'nonaktif'),
      ('s-5', '0012345675', '26005', 'Eka Putri', 'P', 'kelas-12-mipa-2', 'aktif');
  `);

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
          return { meta: { changes: info.changes } };
        },
      });
      return {
        ...exec([]),
        bind: (...params: any[]) => exec(params),
      };
    },
  };

  return { sqlite, d1 };
}

// Helper to create an in-memory mock KVNamespace for rate limiting tests
function createMockKV() {
  const map = new Map<string, { value: string; expires?: number }>();
  return {
    get: async (k: string) => {
      const item = map.get(k);
      if (!item) return null;
      if (item.expires && Date.now() > item.expires) {
        map.delete(k);
        return null;
      }
      return item.value;
    },
    put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
      map.set(k, {
        value: v,
        expires: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined,
      });
    },
    delete: async (k: string) => {
      map.delete(k);
    },
    getWithMetadata: async (k: string) => ({
      value: map.get(k)?.value || null,
      metadata: null,
    }),
  } as any;
}

// Helper to create an in-memory mock R2Bucket
function createMockR2() {
  const map = new Map<string, { data: any; metadata?: any }>();
  return {
    put: async (key: string, data: any, opts?: any) => {
      map.set(key, { data, metadata: opts });
    },
    get: async (key: string) => {
      const item = map.get(key);
      if (!item) return null;
      return {
        arrayBuffer: async () => item.data,
        httpMetadata: item.metadata?.httpMetadata,
      };
    },
    delete: async (key: string) => {
      map.delete(key);
    },
  } as any;
}

describe('Phase 4 — Ulangan Harian Domain Test Suite', () => {
  const JWT_SECRET = 'test-phase-4-jwt-secret-key-for-ulangan';

  // Helper to create test tokens
  async function makeStaffToken(staffId: string, role: string, permissions: string[] = []) {
    return signJWT(
      {
        sub: staffId,
        staff_id: staffId,
        username: staffId,
        role: role,
        roles: [role],
        permissions,
        user_type: 'staff',
      },
      JWT_SECRET,
      3600
    );
  }

  it('1. Mansatas Teaching Assignment Adapter: resolves penugasan_mengajar and active students', async () => {
    const { d1: mansatasDb } = createMockMansatasDb();

    // Teacher A assignments
    const assignmentsA = await listTeacherAssignments(mansatasDb, 'user-guru-a');
    assert.equal(assignmentsA.length, 2, 'Teacher A should have 2 teaching assignments');
    assert.equal(assignmentsA[0].nama_mapel, 'Matematika Peminatan');
    assert.equal(assignmentsA[0].class_name, '12 MIPA 1');
    assert.equal(assignmentsA[1].class_name, '12 MIPA 2');

    // Single assignment fetch
    const single = await getTeachingAssignmentById(mansatasDb, 'assign-a1');
    assert.ok(single);
    assert.equal(single?.guru_id, 'user-guru-a');
    assert.equal(single?.kode_mapel, 'MAT-PEM');

    // Active students in class 12 MIPA 1 (should exclude nonaktif student s-4)
    const students = await listActiveStudentsInClass(mansatasDb, 'kelas-12-mipa-1');
    assert.equal(students.length, 3, 'Should only return 3 active students out of 4');
    assert.ok(!students.some((s) => s.source_id === 's-4'), 'Nonaktif student must be excluded');
    assert.equal(students[0].full_name, 'Ahmad Dahlan');
  });

  it('2. Teaching Scope & IDOR Protection: enforces server-authoritative assignment ownership', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // Seed staff profiles
    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika'),
        ('staff-teacher-b', 'user-guru-b', 'guru.b@mansatas.sch.id', 'Guru Biologi'),
        ('staff-admin', 'user-admin', 'admin@mansatas.sch.id', 'Administrator CBT');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher'),
        ('r-b', 'staff-teacher-b', 'teacher'),
        ('r-adm', 'staff-admin', 'admin');
    `).run();

    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['ulangan.access', 'ulangan.exam.create_own', 'ulangan.exam.manage_own'],
    };
    const userB = {
      sub: 'staff-teacher-b',
      staff_id: 'staff-teacher-b',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['ulangan.access', 'ulangan.exam.create_own', 'ulangan.exam.manage_own'],
    };
    const adminUser = {
      sub: 'staff-admin',
      staff_id: 'staff-admin',
      role: 'admin',
      roles: ['admin'],
      permissions: ['*'],
    };

    // Teacher A tries to create exam for Teacher B's assignment ('assign-b1') -> BLOCKED
    const failResult = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-b1',
        title: 'Ulangan Ilegal',
        duration_minutes: 45,
      },
      userA
    );
    assert.equal(failResult.success, false);
    assert.match(failResult.error || '', /Penugasan mengajar tidak valid/);

    // Teacher A creates exam for their own assignment ('assign-a1') -> SUCCESS
    const createResult = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Ulangan Harian 1 Eksponen',
        duration_minutes: 45,
        passing_score: 75,
      },
      userA
    );
    assert.equal(createResult.success, true);
    const examId = createResult.data!.id;

    // Verify persisted fields
    const examDetail = await getUlanganExamDetail(cbtDb, examId, userA);
    assert.ok(examDetail);
    assert.equal(examDetail.mode, 'ulangan');
    assert.equal(examDetail.owner_staff_id, 'staff-teacher-a');
    assert.equal(examDetail.subject_id, 'mapel-mat');
    assert.equal(examDetail.class_id, 'kelas-12-mipa-1');
    assert.equal(examDetail.class_name, '12 MIPA 1');

    // Canonical 1:1 event-exam pairing check
    const pairedEvent = await cbtDb.prepare(`SELECT * FROM cbt_events WHERE id = ?`).bind(createResult.data!.event_id).first<any>();
    assert.ok(pairedEvent);
    assert.equal(pairedEvent.mode, 'ulangan');

    // IDOR Protection: Teacher B tries to access Teacher A's exam -> 403 Forbidden
    await assert.rejects(
      async () => {
        await assertUlanganOwnership(cbtDb, examId, userB);
      },
      (err: any) => err.name === 'ForbiddenError' || /wewenang/i.test(err.message)
    );

    // Teacher A accesses their own exam -> OK
    const verified = await assertUlanganOwnership(cbtDb, examId, userA);
    assert.equal(verified.exam.id, examId);

    // Admin override: Admin accesses Teacher A's exam -> OK
    const adminAccess = await assertUlanganOwnership(cbtDb, examId, adminUser);
    assert.equal(adminAccess.exam.id, examId);
  });

  it('3. Whole-Class Roster Snapshot: enrols active class students with room_id = NULL', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher');
    `).run();

    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['*'],
    };

    const examRes = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Ulangan Harian Bab 2 Logaritma',
      },
      userA
    );
    const examId = examRes.data!.id;

    // Snapshot students of assigned class (12 MIPA 1)
    const snapResult = await snapshotWholeClassRoster(
      cbtDb,
      mansatasDb,
      examId,
      userA
    );

    assert.equal(snapResult.added, 3, 'Must snapshot 3 active students');

    // Verify roster records in CBT DB
    const roster = await listUlanganRoster(cbtDb, examId, userA);
    assert.equal(roster.length, 3);
    for (const item of roster) {
      assert.equal(item.room_id, null, 'Ulangan roster must have room_id = NULL (no fake room)');
      assert.equal(item.class_name, '12 MIPA 1');
    }

    // Idempotent: re-running snapshot does not duplicate students
    const secondSnap = await snapshotWholeClassRoster(
      cbtDb,
      mansatasDb,
      examId,
      userA
    );
    assert.equal(secondSnap.skipped, 3, 'All 3 students should be skipped as duplicates');
    const rosterAfter = await listUlanganRoster(cbtDb, examId, userA);
    assert.equal(rosterAfter.length, 3, 'Repeated snapshot must not create duplicates');
  });

  it('4. Centralized Room Policy: isRoomRequiredForExam returns false only for Ulangan', () => {
    assert.equal(isRoomRequiredForExam('ulangan'), false, 'Room NOT required for Ulangan');
    assert.equal(isRoomRequiredForExam('pmb'), true, 'Room IS required for PMB');
    assert.equal(isRoomRequiredForExam('kegiatan'), true, 'Room IS required for Kegiatan');
    assert.equal(isRoomRequiredForExam('semester'), true, 'Room IS required for Semester');
    assert.equal(isRoomRequiredForExam('tka'), true, 'Room IS required for TKA');
  });

  it('5. Deterministic Readiness Gate & Canonical Lifecycle Transitions', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher');
    `).run();

    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['*'],
    };

    const examRes = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Ulangan Kesiapan Test',
      },
      userA
    );
    const examId = examRes.data!.id;

    // Initial readiness check: questions = 0, roster = 0 -> NOT READY
    const initialReadiness = await checkUlanganReadiness(cbtDb, examId);
    assert.equal(initialReadiness.ready, false);
    assert.equal(initialReadiness.checks.questions?.passed, false);
    assert.equal(initialReadiness.checks.participants?.passed, false);

    // Attempting to transition to 'ready' must fail
    const failTransition = await transitionUlanganStatus(cbtDb, examId, 'ready', userA);
    assert.equal(failTransition.success, false);
    assert.match(failTransition.error || '', /Ulangan belum memenuhi syarat/);

    // Add question
    await cbtDb.prepare(`
      INSERT INTO cbt_questions (id, exam_id, question_order, question_text, points) VALUES
        ('q-1', ?, 1, 'Berapakah 2^3?', 1)
    `).bind(examId).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES
        ('opt-1', 'q-1', 'A', '6', 0)
    `).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES
        ('opt-2', 'q-1', 'B', '8', 1)
    `).run();

    // Snapshot roster
    await snapshotWholeClassRoster(cbtDb, mansatasDb, examId, userA);

    // Readiness check before token: token is a blocker for Ulangan V1!
    const preTokenCheck = await checkUlanganReadiness(cbtDb, examId);
    assert.equal(preTokenCheck.ready, false, 'Ulangan should NOT be ready without active token');
    assert.equal(preTokenCheck.checks.token?.passed, false);
    assert.equal(preTokenCheck.checks.token?.is_blocker, true);

    // Generate classroom token
    await generateExamTokens(cbtDb, examId, {});

    // Readiness check again -> READY
    const readyCheck = await checkUlanganReadiness(cbtDb, examId);
    assert.equal(readyCheck.ready, true, 'Ulangan should now be ready');

    // Transition: draft -> ready
    const readyRes = await transitionUlanganStatus(cbtDb, examId, 'ready', userA);
    assert.equal(readyRes.success, true);
    assert.equal(readyRes.status, 'ready');

    // Transition: ready -> active
    const activeRes = await transitionUlanganStatus(cbtDb, examId, 'active', userA);
    assert.equal(activeRes.success, true);
    assert.equal(activeRes.status, 'active');

    // Transition: active -> completed
    const completedRes = await transitionUlanganStatus(cbtDb, examId, 'completed', userA);
    assert.equal(completedRes.success, true);
    assert.equal(completedRes.status, 'completed');

    // Transition: completed -> archived
    const archivedRes = await transitionUlanganStatus(cbtDb, examId, 'archived', userA);
    assert.equal(archivedRes.success, true);
    assert.equal(archivedRes.status, 'archived');
  });

  it('6. Safe Deletion & 409 Conflict: blocks deletion if sessions exist or status >= ready', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher');
    `).run();

    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['*'],
    };

    // Exam 1: Draft with no sessions -> Deletion SUCCEEDS
    const exam1 = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Draft Exam to Delete',
      },
      userA
    );
    const del1 = await deleteUlanganExam(cbtDb, exam1.data!.id, userA);
    assert.equal(del1.success, true);
    const check1 = await cbtDb.prepare('SELECT id FROM cbt_exams WHERE id = ?').bind(exam1.data!.id).first();
    assert.equal(check1, null, 'Draft exam should be cleanly deleted');
    const eventCheck = await cbtDb.prepare('SELECT id FROM cbt_events WHERE id = ?').bind(exam1.data!.event_id).first();
    assert.equal(eventCheck, null, 'Paired cbt_events record must also be deleted (no orphan)');

    // Exam 2: Has an exam session -> Deletion BLOCKED with 409 Conflict
    const exam2 = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Exam with Sessions',
      },
      userA
    );
    const exam2Id = exam2.data!.id;

    // Simulate student session
    await cbtDb.prepare(`
      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status) VALUES
        ('sess-1', ?, 's-1', 'student', NULL, 'active');
    `).bind(exam2Id).run();

    const del2 = await deleteUlanganExam(cbtDb, exam2Id, userA);
    assert.equal(del2.success, false);
    assert.equal(del2.status, 409);
    assert.match(del2.error || '', /sudah memiliki riwayat pengerjaan/);
  });

  it('7. HTTP API Router /api/ulangan: Questions, Bulk Import, Tokens, and Execution', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // Setup app and mount routes
    const app = new Hono<{
      Bindings: { DB: any; MANSATAS_DB: any; RATE_LIMIT: any; R2: any; JWT_SECRET: string };
      Variables: any;
    }>();

    app.use('*', async (c, next) => {
      c.env = {
        DB: cbtDb,
        MANSATAS_DB: mansatasDb,
        RATE_LIMIT: createMockKV(),
        R2: createMockR2(),
        JWT_SECRET,
      };
      await next();
    });

    app.route('/api/ulangan', ulanganRoutes);
    app.route('/api/student', studentRoutes);

    // Seed staff
    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika'),
        ('staff-teacher-b', 'user-guru-b', 'guru.b@mansatas.sch.id', 'Guru Biologi');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher'),
        ('r-b', 'staff-teacher-b', 'teacher');
    `).run();

    const tokenTeacherA = await makeStaffToken('staff-teacher-a', 'teacher', [
      'ulangan.access',
      'ulangan.exam.create',
      'ulangan.exam.manage_own',
      'ulangan.results.view_own',
      'ulangan.results.export',
    ]);
    const tokenTeacherB = await makeStaffToken('staff-teacher-b', 'teacher', [
      'ulangan.access',
      'ulangan.exam.create',
      'ulangan.exam.manage_own',
    ]);

    // 1. Teacher A queries teaching assignments
    const resAssignments = await app.request('/api/ulangan/teaching-assignments', {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resAssignments.status, 200);
    const assignmentsBody = await resAssignments.json<any>();
    assert.equal(assignmentsBody.data.length, 2);

    // 2. Teacher A creates ulangan
    const resCreate = await app.request('/api/ulangan/exams', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTeacherA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        teaching_assignment_id: 'assign-a1',
        title: 'Ulangan Harian Mat IPA',
        duration_minutes: 60,
        passing_score: 75,
      }),
    });
    assert.equal(resCreate.status, 201);
    const createBody = await resCreate.json<any>();
    const examId = createBody.data.id;

    // 3. Teacher B tries to add question to Teacher A's exam -> 403 Forbidden
    const resBAddQ = await app.request(`/api/ulangan/exams/${examId}/questions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTeacherB}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question_text: 'Pertanyaan pembajak?',
      }),
    });
    assert.equal(resBAddQ.status, 403);

    // 4. Teacher A bulk imports 2 questions
    const resBulkQ = await app.request(`/api/ulangan/exams/${examId}/questions/bulk`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTeacherA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        questions: [
          {
            question_text: 'Berapakah 10 + 15?',
            question_type: 'multiple_choice',
            question_order: 1,
            points: 1,
            options: [
              { option_label: 'A', option_text: '20', is_correct: 0 },
              { option_label: 'B', option_text: '25', is_correct: 1 },
            ],
          },
          {
            question_text: 'Berapakah 5 x 5?',
            question_type: 'multiple_choice',
            question_order: 2,
            points: 1,
            options: [
              { option_label: 'A', option_text: '25', is_correct: 1 },
              { option_label: 'B', option_text: '30', is_correct: 0 },
            ],
          },
        ],
      }),
    });
    assert.equal(resBulkQ.status, 201);

    // 5. Teacher A snapshots whole-class roster
    const resRoster = await app.request(`/api/ulangan/exams/${examId}/roster/snapshot-class`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resRoster.status, 200);

    // 6. Teacher A generates exam token
    const resToken = await app.request(`/api/ulangan/exams/${examId}/tokens/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTeacherA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(resToken.status, 200);
    const resListTokens = await app.request(`/api/ulangan/exams/${examId}/tokens`, {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resListTokens.status, 200);
    const tokenListBody = await resListTokens.json<any>();
    assert.ok(tokenListBody.data.length > 0);
    const activeTokenCode = tokenListBody.data[0].token_code;
    assert.ok(activeTokenCode);

    // 7. Teacher A marks exam as ready then active
    const resReady = await app.request(`/api/ulangan/exams/${examId}/status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTeacherA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'ready' }),
    });
    assert.equal(resReady.status, 200);

    const resActive = await app.request(`/api/ulangan/exams/${examId}/status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenTeacherA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(resActive.status, 200);

    // 8. Student execution: Student Ahmad Dahlan ('s-1' / '0012345671') from class 12 MIPA 1 starts exam
    const studentToken = await signJWT(
      {
        sub: 's-1',
        username: '0012345671',
        role: 'student',
        user_type: 'student',
        source: 'mansatas',
      },
      JWT_SECRET,
      3600
    );

    // Start exam session with token code via /api/student/exams/:examId/validate-token
    const resStart = await app.request(`/api/student/exams/${examId}/validate-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token_code: activeTokenCode,
        device_id: 'test-device-1',
      }),
    });
    assert.ok(resStart.status === 200 || resStart.status === 201, 'Student must be able to start Ulangan without room_id');
    const startBody = await resStart.json<any>();
    assert.ok(startBody.data?.session_id);
    const sessionId = startBody.data.session_id;

    // Get questions and options
    const q1 = (await cbtDb.prepare('SELECT id FROM cbt_questions WHERE exam_id=? AND question_order=1').bind(examId).first<any>())!;
    const q2 = (await cbtDb.prepare('SELECT id FROM cbt_questions WHERE exam_id=? AND question_order=2').bind(examId).first<any>())!;
    const optQ1Correct = (await cbtDb.prepare('SELECT id FROM cbt_question_options WHERE question_id=? AND is_correct=1').bind(q1.id).first<any>())!;
    const optQ2Wrong = (await cbtDb.prepare('SELECT id FROM cbt_question_options WHERE question_id=? AND is_correct=0').bind(q2.id).first<any>())!;

    const answersToSubmit = [
      { question_id: q1.id, selected_option_id: optQ1Correct.id },
      { question_id: q2.id, selected_option_id: optQ2Wrong.id },
    ];

    // Save answer
    const resAnswer = await app.request(`/api/student/sessions/${sessionId}/answers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        answers: answersToSubmit,
      }),
    });
    assert.equal(resAnswer.status, 200);

    // Submit exam
    const resSubmit = await app.request(`/api/student/sessions/${sessionId}/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${studentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        answers: answersToSubmit,
      }),
    });
    assert.equal(resSubmit.status, 200);

    // 9. Teacher A views monitoring, results, and analytics via /api/ulangan
    const resSessions = await app.request(`/api/ulangan/exams/${examId}/sessions`, {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resSessions.status, 200);
    const sessionsBody = await resSessions.json<any>();
    assert.equal(sessionsBody.data.length, 1);
    assert.equal(sessionsBody.data[0].status, 'submitted');

    const resResults = await app.request(`/api/ulangan/exams/${examId}/results`, {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resResults.status, 200);
    const resultsBody = await resResults.json<any>();
    assert.equal(resultsBody.data.length, 1);
    assert.equal(resultsBody.data[0].score, 50, '1 correct out of 2 questions = 50%');

    const resAnalytics = await app.request(`/api/ulangan/exams/${examId}/question-analytics`, {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resAnalytics.status, 200);

    // Teacher B tries to view Teacher A's results -> 403 Forbidden
    const resBResults = await app.request(`/api/ulangan/exams/${examId}/results`, {
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resBResults.status, 403);
  });

  it('8. Teacher Identity Bridge: cbt_staff_profiles.mansatas_user_id -> penugasan_mengajar.guru_id', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // Teacher X has CBT staff_id 'staff-xyz-99' which is distinct from Mansatas guru_id 'user-guru-a'
    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-xyz-99', 'user-guru-a', 'guru.bridge@mansatas.sch.id', 'Guru Bridge Test');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-xyz', 'staff-xyz-99', 'teacher');
    `).run();

    const userX = {
      sub: 'staff-xyz-99',
      staff_id: 'staff-xyz-99',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['ulangan.access', 'ulangan.exam.create_own', 'ulangan.exam.manage_own'],
    };

    // UserX creates exam for assign-a1 (where guru_id = 'user-guru-a') -> SUCCEEDS
    const res = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Ulangan Identity Bridge',
      },
      userX
    );
    assert.equal(res.success, true);
    const examRow = await cbtDb.prepare('SELECT owner_staff_id FROM cbt_exams WHERE id = ?').bind(res.data!.id).first<any>();
    assert.equal(examRow.owner_staff_id, 'staff-xyz-99');

    // Teacher Y with different mansatas_user_id fails to use assign-a1
    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-xyz-100', 'user-guru-other', 'guru.other@mansatas.sch.id', 'Guru Other');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-xyz-2', 'staff-xyz-100', 'teacher');
    `).run();

    const userY = {
      sub: 'staff-xyz-100',
      staff_id: 'staff-xyz-100',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['ulangan.access', 'ulangan.exam.create_own', 'ulangan.exam.manage_own'],
    };

    const resFail = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Ulangan Identity Bridge Fail',
      },
      userY
    );
    assert.equal(resFail.success, false);
    assert.match(resFail.error || '', /Penugasan mengajar tidak valid/);
  });

  it('9. Global 1:1 Invariant on cbt_events & Canonical NULL Roomless State', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika')
    `).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher')
    `).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status) VALUES
        ('ev-uh-1to1', 'EV-UH-1TO1', 'Event Ulangan 1to1', 'ulangan', 'draft'),
        ('ev-kegiatan-multi', 'EV-KEG-MULTI', 'Event Kegiatan Multi', 'kegiatan', 'draft')
    `).run();

    const adminUser = { sub: 'staff-admin', staff_id: 'staff-admin' };

    // 1. Create 1st exam for Ulangan event -> SUCCEEDS
    const res1 = await createExam(cbtDb, {
      title: 'Ujian 1 Ulangan',
      event_id: 'ev-uh-1to1',
      mode: 'ulangan',
      duration_minutes: 45,
    }, adminUser);
    assert.equal(res1.success, true, res1.error);

    // 2. Create 2nd exam for same Ulangan event -> FAILS with 409 Conflict
    const res2 = await createExam(cbtDb, {
      title: 'Ujian 2 Ulangan Ilegal',
      event_id: 'ev-uh-1to1',
      mode: 'ulangan',
      duration_minutes: 45,
    }, adminUser);
    assert.equal(res2.success, false);
    assert.equal(res2.status, 409);
    assert.match(res2.error || '', /1:1 event-exam/);

    // Direct raw SQL insert attempting to bypass application logic is blocked by partial unique index
    let dbSafetyNetTriggered = false;
    try {
      await cbtDb.prepare(`
        INSERT INTO cbt_exams (id, title, event_id, mode, duration_minutes)
        VALUES ('raw-bypass-exam', 'Direct SQL Bypass', 'ev-uh-1to1', 'ulangan', 45)
      `).run();
    } catch (err: any) {
      dbSafetyNetTriggered = true;
      assert.match(err.message, /UNIQUE constraint failed/i);
    }
    assert.equal(dbSafetyNetTriggered, true, 'Database partial unique index must block raw SQL bypass');

    // 3. Multi-exam domain (Kegiatan): Create 2 exams for same event -> BOTH SUCCEED
    const resKeg1 = await createExam(cbtDb, {
      title: 'Ujian Babak 1',
      event_id: 'ev-kegiatan-multi',
      mode: 'kegiatan',
      duration_minutes: 60,
    }, adminUser);
    assert.equal(resKeg1.success, true);
    const resKeg2 = await createExam(cbtDb, {
      title: 'Ujian Babak 2',
      event_id: 'ev-kegiatan-multi',
      mode: 'kegiatan',
      duration_minutes: 60,
    }, adminUser);
    assert.equal(resKeg2.success, true);

    // 4. Roomless NULL state verification
    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['*'],
    };
    const ulanganExamRes = await createUlanganExam(
      cbtDb,
      mansatasDb,
      {
        teaching_assignment_id: 'assign-a1',
        title: 'Ulangan Roomless Check',
      },
      userA
    );
    const uExamId = ulanganExamRes.data!.id;

    await snapshotWholeClassRoster(cbtDb, mansatasDb, uExamId, userA);
    await generateExamTokens(cbtDb, uExamId, {});

    const rosterRows = await cbtDb.prepare('SELECT room_id FROM cbt_exam_roster WHERE exam_id = ?').bind(uExamId).all<any>();
    for (const r of rosterRows.results) {
      assert.strictEqual(r.room_id, null, 'cbt_exam_roster.room_id must strictly be null');
    }

    const tokenRows = await cbtDb.prepare('SELECT room_id FROM cbt_exam_tokens WHERE exam_id = ?').bind(uExamId).all<any>();
    for (const t of tokenRows.results) {
      assert.strictEqual(t.room_id, null, 'cbt_exam_tokens.room_id must strictly be null');
    }

    // Verify zero 'unassigned' strings across all tables
    const fakeInRoster = await cbtDb.prepare("SELECT COUNT(*) AS c FROM cbt_exam_roster WHERE room_id = 'unassigned'").first<any>();
    assert.equal(fakeInRoster.c, 0);
    const fakeInTokens = await cbtDb.prepare("SELECT COUNT(*) AS c FROM cbt_exam_tokens WHERE room_id = 'unassigned'").first<any>();
    assert.equal(fakeInTokens.c, 0);
  });

  it('10. Centralized Domain Room Requirement Enforcement: PMB & Kegiatan reject roomless; Ulangan allows', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    const app = new Hono<{
      Bindings: { DB: any; MANSATAS_DB: any; RATE_LIMIT: any; R2: any; JWT_SECRET: string };
      Variables: any;
    }>();

    app.use('*', async (c, next) => {
      c.env = {
        DB: cbtDb,
        MANSATAS_DB: mansatasDb,
        RATE_LIMIT: createMockKV(),
        R2: createMockR2(),
        JWT_SECRET,
      };
      await next();
    });
    app.route('/api/student', studentRoutes);

    // Seed events and exams for PMB, Kegiatan, and Ulangan
    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status) VALUES
        ('ev-pmb-req', 'EV-PMB-REQ', 'PMB Event', 'pmb', 'active'),
        ('ev-keg-req', 'EV-KEG-REQ', 'Kegiatan Event', 'kegiatan', 'active'),
        ('ev-uh-req', 'EV-UH-REQ', 'Ulangan Event', 'ulangan', 'active')
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, event_id, active_status, duration_minutes) VALUES
        ('exam-pmb-1', 'Ujian Masuk PMB', 'pmb', 'ev-pmb-req', 'active', 60),
        ('exam-keg-1', 'Lomba Tahfidz', 'kegiatan', 'ev-keg-req', 'active', 60),
        ('exam-uh-1', 'Ulangan Kimia', 'ulangan', 'ev-uh-req', 'active', 60)
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active) VALUES
        ('t-pmb', 'exam-pmb-1', NULL, 'TOKENP', 1),
        ('t-keg', 'exam-keg-1', NULL, 'TOKENK', 1),
        ('t-uh', 'exam-uh-1', NULL, 'TOKENU', 1)
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_questions (id, exam_id, question_order, question_text) VALUES
        ('q-pmb', 'exam-pmb-1', 1, 'Soal PMB'),
        ('q-keg', 'exam-keg-1', 1, 'Soal Kegiatan'),
        ('q-uh', 'exam-uh-1', 1, 'Soal Ulangan')
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id) VALUES
        ('r-pmb', 'exam-pmb-1', 'ev-pmb-req', 'mansatas', 's-noroom', 'student_noroom', 'Student No Room', NULL),
        ('r-keg', 'exam-keg-1', 'ev-keg-req', 'mansatas', 's-noroom', 'student_noroom', 'Student No Room', NULL),
        ('r-uh', 'exam-uh-1', 'ev-uh-req', 'mansatas', 's-noroom', 'student_noroom', 'Student No Room', NULL)
    `).run();

    // Student without room_id
    const studentTokenNoRoom = await signJWT(
      { sub: 's-noroom', username: 'student_noroom', role: 'student', user_type: 'student', source: 'mansatas' },
      JWT_SECRET,
      3600
    );

    // 1. PMB student without room -> REJECTED with 400
    const resPmb = await app.request('/api/student/exams/exam-pmb-1/validate-token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokenNoRoom}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_code: 'TOKENP', device_id: 'dev-1' }),
    });
    assert.equal(resPmb.status, 400);
    const bodyPmb = await resPmb.json<any>();
    assert.match(bodyPmb.error || '', /belum di-assign ke ruangan/);

    // 2. Kegiatan student without room -> REJECTED with 400
    const resKeg = await app.request('/api/student/exams/exam-keg-1/validate-token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokenNoRoom}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_code: 'TOKENK', device_id: 'dev-1' }),
    });
    assert.equal(resKeg.status, 400);
    const bodyKeg = await resKeg.json<any>();
    assert.match(bodyKeg.error || '', /belum di-assign ke ruangan/);

    // 3. Ulangan student without room -> SUCCEEDS (roomless permitted)
    const resUh = await app.request('/api/student/exams/exam-uh-1/validate-token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentTokenNoRoom}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_code: 'TOKENU', device_id: 'dev-1' }),
    });
    assert.ok(resUh.status === 200 || resUh.status === 201);
    const bodyUh = await resUh.json<any>();
    assert.ok(bodyUh.data?.session_id);

    // Verify persisted session in DB has room_id = NULL
    const sess = await cbtDb.prepare('SELECT room_id FROM cbt_exam_sessions WHERE id = ?').bind(bodyUh.data.session_id).first<any>();
    assert.strictEqual(sess.room_id, null, 'cbt_exam_sessions.room_id must strictly be null');
  });

  it('11. Canonical Lifecycle Orchestration, Rollback & Safe Deletion State Matrix', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika')
    `).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher')
    `).run();

    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['*'],
    };

    // 1. Explicit canonical lifecycle validation: direct ready -> draft transition = rejected
    const directIllegalRollback = validateEventTransition('ready', 'draft');
    assert.equal(directIllegalRollback.valid, false);
    assert.match(directIllegalRollback.error || '', /Transisi status tidak diizinkan/);

    // Helper to verify event.status and exam.active_status are strictly synchronized
    const assertSynchronizedStatus = async (eid: string, xid: string, expectedStatus: string) => {
      const ev = await cbtDb.prepare('SELECT status FROM cbt_events WHERE id = ?').bind(eid).first<any>();
      const ex = await cbtDb.prepare('SELECT active_status FROM cbt_exams WHERE id = ?').bind(xid).first<any>();
      assert.equal(ev?.status, expectedStatus, `cbt_events.status must be ${expectedStatus}`);
      assert.equal(ex?.active_status, expectedStatus, `cbt_exams.active_status must be ${expectedStatus}`);
    };

    // 2. Comprehensive Forward Lifecycle Transitions:
    // draft -> configuration -> ready -> active -> completed -> archived
    const examRes = await createUlanganExam(cbtDb, mansatasDb, {
      teaching_assignment_id: 'assign-a1',
      title: 'Ulangan Lifecycle Sync Test',
    }, userA);
    const examId = examRes.data!.id;
    const eventId = examRes.data!.event_id;
    await assertSynchronizedStatus(eventId, examId, 'draft');

    // a. draft -> configuration
    const resConfig = await transitionUlanganStatus(cbtDb, examId, 'configuration', userA);
    assert.equal(resConfig.success, true);
    await assertSynchronizedStatus(eventId, examId, 'configuration');

    // Seed requirements for readiness
    await cbtDb.prepare(`
      INSERT INTO cbt_questions (id, exam_id, question_order, question_text, points) VALUES
        ('q-life', ?, 1, 'Soal 1', 1)
    `).bind(examId).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES
        ('o-life-1', 'q-life', 'A', 'Opt 1', 1)
    `).run();
    await snapshotWholeClassRoster(cbtDb, mansatasDb, examId, userA);
    await generateExamTokens(cbtDb, examId, {});

    // b. configuration -> ready
    const resReady = await transitionUlanganStatus(cbtDb, examId, 'ready', userA);
    assert.equal(resReady.success, true);
    await assertSynchronizedStatus(eventId, examId, 'ready');

    // c. ready -> active
    const resActive = await transitionUlanganStatus(cbtDb, examId, 'active', userA);
    assert.equal(resActive.success, true);
    await assertSynchronizedStatus(eventId, examId, 'active');

    // d. active -> completed
    const resCompleted = await transitionUlanganStatus(cbtDb, examId, 'completed', userA);
    assert.equal(resCompleted.success, true);
    await assertSynchronizedStatus(eventId, examId, 'completed');

    // e. completed -> archived
    const resArchived = await transitionUlanganStatus(cbtDb, examId, 'archived', userA);
    assert.equal(resArchived.success, true);
    await assertSynchronizedStatus(eventId, examId, 'archived');

    // 3. Rollback Transitions on Second Exam:
    // draft -> configuration -> ready -> configuration -> draft, plus convenience ready -> draft
    const exam2Res = await createUlanganExam(cbtDb, mansatasDb, {
      teaching_assignment_id: 'assign-a1',
      title: 'Ulangan Rollback Sync Test',
    }, userA);
    const examId2 = exam2Res.data!.id;
    const eventId2 = exam2Res.data!.event_id;
    await assertSynchronizedStatus(eventId2, examId2, 'draft');

    // Seed requirements for exam2
    await cbtDb.prepare(`
      INSERT INTO cbt_questions (id, exam_id, question_order, question_text, points) VALUES
        ('q-life2', ?, 1, 'Soal 1', 1)
    `).bind(examId2).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES
        ('o-life2-1', 'q-life2', 'A', 'Opt 1', 1)
    `).run();
    await snapshotWholeClassRoster(cbtDb, mansatasDb, examId2, userA);
    await generateExamTokens(cbtDb, examId2, {});

    // draft -> ready (orchestrates through configuration)
    await transitionUlanganStatus(cbtDb, examId2, 'ready', userA);
    await assertSynchronizedStatus(eventId2, examId2, 'ready');

    // Stepwise rollback: ready -> configuration
    const resRollbackConfig = await transitionUlanganStatus(cbtDb, examId2, 'configuration', userA);
    assert.equal(resRollbackConfig.success, true);
    await assertSynchronizedStatus(eventId2, examId2, 'configuration');

    // Stepwise rollback: configuration -> draft
    const resRollbackDraft = await transitionUlanganStatus(cbtDb, examId2, 'draft', userA);
    assert.equal(resRollbackDraft.success, true);
    await assertSynchronizedStatus(eventId2, examId2, 'draft');

    // Convenience rollback: ready -> configuration -> draft in single call
    await transitionUlanganStatus(cbtDb, examId2, 'ready', userA);
    await assertSynchronizedStatus(eventId2, examId2, 'ready');
    const resConvenience = await transitionUlanganStatus(cbtDb, examId2, 'draft', userA);
    assert.equal(resConvenience.success, true);
    await assertSynchronizedStatus(eventId2, examId2, 'draft');

    // 4. Verify generic/shared endpoint cannot independently force active_status into a conflicting state
    const illegalDirectMutation = await updateExam(cbtDb, examId2, { active_status: 'active' });
    assert.equal(illegalDirectMutation.success, false);
    assert.equal(illegalDirectMutation.status, 400);
    assert.match(illegalDirectMutation.error || '', /dikelola secara kanonikal melalui lifecycle event/);
    await assertSynchronizedStatus(eventId2, examId2, 'draft');

    // 5. Safe Deletion Matrix:
    // a. Draft state with 0 sessions -> Deletion permitted and paired event removed
    const delDraft = await deleteUlanganExam(cbtDb, examId2, userA);
    assert.equal(delDraft.success, true);
    const countExamAfter = await cbtDb.prepare('SELECT COUNT(*) as count FROM cbt_exams WHERE id = ?').bind(examId2).first<any>();
    assert.equal(countExamAfter.count, 0);
    const countEventAfter = await cbtDb.prepare('SELECT COUNT(*) as count FROM cbt_events WHERE id = ?').bind(eventId2).first<any>();
    assert.equal(countEventAfter.count, 0); // Paired event removed, zero orphans!

    // b. Configuration state with 0 sessions -> Deletion permitted
    const examConfig = await createUlanganExam(cbtDb, mansatasDb, {
      teaching_assignment_id: 'assign-a1',
      title: 'Config State Exam',
    }, userA);
    await cbtDb.prepare("UPDATE cbt_events SET status = 'configuration' WHERE id = ?").bind(examConfig.data!.event_id).run();
    const delConfig = await deleteUlanganExam(cbtDb, examConfig.data!.id, userA);
    assert.equal(delConfig.success, true);
    const countConfigEvent = await cbtDb.prepare('SELECT COUNT(*) as count FROM cbt_events WHERE id = ?').bind(examConfig.data!.event_id).first<any>();
    assert.equal(countConfigEvent.count, 0);

    // c. States ready, active, completed, archived -> Deletion rejected regardless of sessions
    for (const lockedStatus of ['ready', 'active', 'completed', 'archived'] as const) {
      const examLocked = await createUlanganExam(cbtDb, mansatasDb, {
        teaching_assignment_id: 'assign-a1',
        title: `Locked ${lockedStatus} Exam`,
      }, userA);
      await cbtDb.prepare('UPDATE cbt_events SET status = ? WHERE id = ?').bind(lockedStatus, examLocked.data!.event_id).run();
      const delLocked = await deleteUlanganExam(cbtDb, examLocked.data!.id, userA);
      assert.equal(delLocked.success, false, `Deletion must fail for ${lockedStatus}`);
      assert.equal(delLocked.status, 409);
      assert.match(delLocked.error || '', new RegExp(`status '${lockedStatus}' tidak dapat dihapus`));
    }

    // d. Draft with attempt history (1 session) -> Deletion rejected with 409
    const examWithSession = await createUlanganExam(cbtDb, mansatasDb, {
      teaching_assignment_id: 'assign-a1',
      title: 'Exam With Attempt History',
    }, userA);
    await cbtDb.prepare(`
      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status) VALUES
        ('sess-history-1', ?, 's-1', 'student', NULL, 'submitted')
    `).bind(examWithSession.data!.id).run();
    const delWithSession = await deleteUlanganExam(cbtDb, examWithSession.data!.id, userA);
    assert.equal(delWithSession.success, false);
    assert.equal(delWithSession.status, 409);
    assert.match(delWithSession.error || '', /memiliki riwayat pengerjaan siswa/);
  });

  it('12. Historical Teaching Context Preservation: surviving Mansatas assignment deletion & academic year change', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb, sqlite: mSqlite } = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher');
    `).run();

    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['*'],
    };

    const examRes = await createUlanganExam(cbtDb, mansatasDb, {
      teaching_assignment_id: 'assign-a1',
      title: 'Ulangan Historical Test',
    }, userA);
    const examId = examRes.data!.id;

    // 1. Remove/delete all teaching assignments for Guru A and the subject lookup in mock Mansatas DB
    mSqlite.exec("DELETE FROM penugasan_mengajar WHERE guru_id = 'user-guru-a'");
    mSqlite.exec("DELETE FROM mata_pelajaran WHERE id = 'mapel-mat'");

    // 2. Change active academic year in mock Mansatas DB
    mSqlite.exec("UPDATE tahun_ajaran SET is_active = 0 WHERE id = 'ta-2026'");
    mSqlite.exec("INSERT INTO tahun_ajaran (id, nama, semester, is_active) VALUES ('ta-2027', '2027/2028', 'Genap', 1)");

    // 3. Open historical Ulangan (getUlanganExamDetail) -> all original context preserved
    const detail = await getUlanganExamDetail(cbtDb, examId, userA);
    assert.equal(detail.owner_staff_id, 'staff-teacher-a');
    assert.equal(detail.subject_name, 'Matematika Peminatan');
    assert.equal(detail.subject_id, 'mapel-mat');
    assert.equal(detail.class_name, '12 MIPA 1');
    assert.equal(detail.class_id, 'kelas-12-mipa-1');
    assert.equal(detail.academic_year_id, 'ta-2026');
    assert.equal(detail.academic_year_name, '2026/2027');
    assert.equal(detail.term, '1');

    // 4. List historical Ulangan (listUlanganExams) -> all original context preserved
    const list = await listUlanganExams(cbtDb, userA, {});
    assert.equal(list.length, 1);
    assert.equal(list[0].owner_staff_id, 'staff-teacher-a');
    assert.equal(list[0].subject_name, 'Matematika Peminatan');
    assert.equal(list[0].class_name, '12 MIPA 1');
    assert.equal(list[0].academic_year_id, 'ta-2026');
    assert.equal(list[0].academic_year_name, '2026/2027');
    assert.equal(list[0].term, '1');
  });

  it('13. Shared UI Views Contract Matrix & Child IDOR Protection across all endpoints', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    const app = new Hono<{
      Bindings: { DB: any; MANSATAS_DB: any; RATE_LIMIT: any; R2: any; JWT_SECRET: string };
      Variables: any;
    }>();

    app.use('*', async (c, next) => {
      c.env = {
        DB: cbtDb,
        MANSATAS_DB: mansatasDb,
        RATE_LIMIT: createMockKV(),
        R2: createMockR2(),
        JWT_SECRET,
      };
      await next();
    });
    app.route('/api/ulangan', ulanganRoutes);

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika'),
        ('staff-teacher-b', 'user-guru-b', 'guru.b@mansatas.sch.id', 'Guru Biologi');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher'),
        ('r-b', 'staff-teacher-b', 'teacher');
    `).run();

    const tokenTeacherA = await makeStaffToken('staff-teacher-a', 'teacher', [
      'ulangan.access',
      'ulangan.exam.create',
      'ulangan.exam.manage_own',
      'ulangan.results.view_own',
      'ulangan.results.export',
    ]);
    const tokenTeacherB = await makeStaffToken('staff-teacher-b', 'teacher', [
      'ulangan.access',
      'ulangan.exam.create',
      'ulangan.exam.manage_own',
    ]);

    // Teacher A creates exam
    const resCreate = await app.request('/api/ulangan/exams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teaching_assignment_id: 'assign-a1', title: 'Ulangan Contract Test' }),
    });
    const examId = (await resCreate.json<any>()).data.id;

    // 1. QuestionsView:
    // a. GET /api/ulangan/exams/:id/questions
    const resGetQB = await app.request(`/api/ulangan/exams/${examId}/questions`, {
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resGetQB.status, 403);
    const resGetQA = await app.request(`/api/ulangan/exams/${examId}/questions`, {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resGetQA.status, 200);

    // b. POST /api/ulangan/exams/:id/questions
    const resAddQB = await app.request(`/api/ulangan/exams/${examId}/questions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text: 'Hacked Q', question_type: 'multiple_choice', points: 1 }),
    });
    assert.equal(resAddQB.status, 403);

    const resAddQA = await app.request(`/api/ulangan/exams/${examId}/questions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text: 'Soal Original', question_type: 'multiple_choice', points: 1 }),
    });
    assert.equal(resAddQA.status, 201);
    const qId = (await resAddQA.json<any>()).data.id;

    // c. PUT /api/ulangan/questions/:id
    const resPutB = await app.request(`/api/ulangan/questions/${qId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenTeacherB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text: 'Hacked question' }),
    });
    assert.equal(resPutB.status, 403);

    const resPutA = await app.request(`/api/ulangan/questions/${qId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text: 'Soal Updated oleh Guru A' }),
    });
    assert.equal(resPutA.status, 200);

    // d. POST /api/ulangan/upload (media upload requiring owned exam_id)
    // Missing exam_id -> 400 Bad Request
    const fdNoExam = new FormData();
    fdNoExam.append('file', new Blob(['mock-bytes'], { type: 'image/png' }), 'diagram.png');
    const resUpNoExam = await app.request('/api/ulangan/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
      body: fdNoExam,
    });
    assert.equal(resUpNoExam.status, 400);

    // Unowned exam_id -> 403 Forbidden
    const fdUnowned = new FormData();
    fdUnowned.append('file', new Blob(['mock-bytes'], { type: 'image/png' }), 'diagram.png');
    fdUnowned.append('exam_id', examId);
    const resUpUnowned = await app.request('/api/ulangan/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
      body: fdUnowned,
    });
    assert.equal(resUpUnowned.status, 403);

    // Owned exam_id -> 200 OK
    const fdOwned = new FormData();
    fdOwned.append('file', new Blob(['mock-bytes'], { type: 'image/png' }), 'diagram.png');
    fdOwned.append('exam_id', examId);
    const resUpOwned = await app.request('/api/ulangan/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
      body: fdOwned,
    });
    assert.equal(resUpOwned.status, 200);
    const upBody = await resUpOwned.json<any>();
    assert.ok(upBody.data.url.includes(`ulangan/${examId}/`));

    // 2. BulkImport: POST /api/ulangan/exams/:id/questions/bulk
    const resBulkB = await app.request(`/api/ulangan/exams/${examId}/questions/bulk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: [{ question_text: 'Bulk Q1', question_type: 'multiple_choice', points: 1 }],
      }),
    });
    assert.equal(resBulkB.status, 403);

    const resBulkA = await app.request(`/api/ulangan/exams/${examId}/questions/bulk`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: [{ question_text: 'Bulk Q1', question_type: 'multiple_choice', points: 1 }],
      }),
    });
    assert.equal(resBulkA.status, 201);

    // 3. TokensView:
    // a. Generate tokens
    const resGenB = await app.request(`/api/ulangan/exams/${examId}/tokens/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resGenB.status, 403);
    const resGenA = await app.request(`/api/ulangan/exams/${examId}/tokens/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resGenA.status, 200);

    // b. List tokens: GET /api/ulangan/exams/:id/tokens
    const resTokB = await app.request(`/api/ulangan/exams/${examId}/tokens`, {
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resTokB.status, 403);
    const resTokA = await app.request(`/api/ulangan/exams/${examId}/tokens`, {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resTokA.status, 200);
    const tokenId = (await resTokA.json<any>()).data[0].id;

    // c. Toggle token active: POST /api/ulangan/exams/:id/tokens/:tokenId/active
    const resActiveB = await app.request(`/api/ulangan/exams/${examId}/tokens/${tokenId}/active`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: 0 }),
    });
    assert.equal(resActiveB.status, 403);

    const resActiveA = await app.request(`/api/ulangan/exams/${examId}/tokens/${tokenId}/active`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: 1 }),
    });
    assert.equal(resActiveA.status, 200);

    // d. Set custom token code: POST /api/ulangan/exams/:id/tokens/set-code
    const resSetCodeB = await app.request(`/api/ulangan/exams/${examId}/tokens/set-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_code: 'MAT123' }),
    });
    assert.equal(resSetCodeB.status, 403);

    const resSetCodeA = await app.request(`/api/ulangan/exams/${examId}/tokens/set-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_code: 'MAT123' }),
    });
    assert.equal(resSetCodeA.status, 200);

    // 4. Seed student session & results for Monitoring, Results, Analytics
    await cbtDb.prepare(`
      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status) VALUES
        ('sess-t13', ?, 's-1', 'student', NULL, 'active')
    `).bind(examId).run();
    await cbtDb.prepare(`
      INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, score) VALUES
        ('res-t13', 'sess-t13', ?, 's-1', 'student', 80)
    `).bind(examId).run();

    // 5. MonitorView:
    // a. GET /api/ulangan/exams/:id/sessions
    const resSessB = await app.request(`/api/ulangan/exams/${examId}/sessions`, { headers: { Authorization: `Bearer ${tokenTeacherB}` } });
    assert.equal(resSessB.status, 403);
    const resSessA = await app.request(`/api/ulangan/exams/${examId}/sessions`, { headers: { Authorization: `Bearer ${tokenTeacherA}` } });
    assert.equal(resSessA.status, 200);

    // b. Unlock: POST /api/ulangan/exams/:id/sessions/:sessionId/unlock
    const resUnlockB = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/unlock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resUnlockB.status, 403);
    const resUnlockA = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/unlock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resUnlockA.status, 200);

    // c. Reset: POST /api/ulangan/exams/:id/sessions/:sessionId/reset
    const resResetB = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resResetB.status, 403);
    const resResetA = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resResetA.status, 200);

    // d. Extend time: POST /api/ulangan/exams/:id/sessions/:sessionId/extend
    const resExtB = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/extend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 15 }),
    });
    assert.equal(resExtB.status, 403);
    const resExtA = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/extend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 15 }),
    });
    assert.equal(resExtA.status, 200);

    // e. Force submit: POST /api/ulangan/exams/:id/sessions/:sessionId/force-submit
    const resFsB = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/force-submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resFsB.status, 403);
    const resFsA = await app.request(`/api/ulangan/exams/${examId}/sessions/sess-t13/force-submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resFsA.status, 200);

    // 6. ResultsView:
    // a. GET /api/ulangan/exams/:id/results
    const resResB = await app.request(`/api/ulangan/exams/${examId}/results`, { headers: { Authorization: `Bearer ${tokenTeacherB}` } });
    assert.equal(resResB.status, 403);
    const resResA = await app.request(`/api/ulangan/exams/${examId}/results`, { headers: { Authorization: `Bearer ${tokenTeacherA}` } });
    assert.equal(resResA.status, 200);

    // b. GET /api/ulangan/exams/:id/results-export
    const resExpB = await app.request(`/api/ulangan/exams/${examId}/results-export`, { headers: { Authorization: `Bearer ${tokenTeacherB}` } });
    assert.equal(resExpB.status, 403);
    const resExpA = await app.request(`/api/ulangan/exams/${examId}/results-export`, { headers: { Authorization: `Bearer ${tokenTeacherA}` } });
    assert.equal(resExpA.status, 200);

    // c. POST /api/ulangan/exams/:id/results/recompute-missing
    const resRecB = await app.request(`/api/ulangan/exams/${examId}/results/recompute-missing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resRecB.status, 403);
    const resRecA = await app.request(`/api/ulangan/exams/${examId}/results/recompute-missing`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resRecA.status, 200);

    // d. DELETE /api/ulangan/exams/:id/results/:sessionId
    const resDelResB = await app.request(`/api/ulangan/exams/${examId}/results/sess-t13`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resDelResB.status, 403);
    const resDelResA = await app.request(`/api/ulangan/exams/${examId}/results/sess-t13`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resDelResA.status, 200);

    // 7. AnalyticsView:
    // GET /api/ulangan/exams/:id/question-analytics
    const resAnaB = await app.request(`/api/ulangan/exams/${examId}/question-analytics`, { headers: { Authorization: `Bearer ${tokenTeacherB}` } });
    assert.equal(resAnaB.status, 403);
    const resAnaA = await app.request(`/api/ulangan/exams/${examId}/question-analytics`, { headers: { Authorization: `Bearer ${tokenTeacherA}` } });
    assert.equal(resAnaA.status, 200);

    // 8. Question Delete: DELETE /api/ulangan/questions/:id
    const resDelQB = await app.request(`/api/ulangan/questions/${qId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenTeacherB}` },
    });
    assert.equal(resDelQB.status, 403);
    const resDelQA = await app.request(`/api/ulangan/questions/${qId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resDelQA.status, 200);
  });

  it('14. Declared Canonical Ownership Authority: cbt_exams.owner_staff_id cannot be spoofed or bypassed', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika'),
        ('staff-teacher-b', 'user-guru-b', 'guru.b@mansatas.sch.id', 'Guru Biologi');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher'),
        ('r-b', 'staff-teacher-b', 'teacher');
    `).run();

    const userA = {
      sub: 'staff-teacher-a',
      staff_id: 'staff-teacher-a',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['ulangan.access', 'ulangan.exam.manage_own'],
    };

    const userB = {
      sub: 'staff-teacher-b',
      staff_id: 'staff-teacher-b',
      role: 'teacher',
      roles: ['teacher'],
      permissions: ['ulangan.access', 'ulangan.exam.manage_own'],
    };

    const examRes = await createUlanganExam(cbtDb, mansatasDb, {
      teaching_assignment_id: 'assign-a1',
      title: 'Ownership Authority Test',
    }, userA);
    const examId = examRes.data!.id;

    // Verify persisted authority
    const examRow = await cbtDb.prepare('SELECT owner_staff_id, created_by FROM cbt_exams WHERE id = ?').bind(examId).first<any>();
    assert.equal(examRow.owner_staff_id, 'staff-teacher-a');

    // Attempt to hijack via spoofed created_by column in database
    await cbtDb.prepare("UPDATE cbt_exams SET created_by = 'staff-teacher-b' WHERE id = ?").bind(examId).run();

    // Teacher B tries to access assertUlanganOwnership -> MUST FAIL with 403 Forbidden!
    await assert.rejects(
      async () => {
        await assertUlanganOwnership(cbtDb, examId, userB);
      },
      (err: any) => err.name === 'ForbiddenError' && err.message.includes('Anda bukan pemilik ulangan ini')
    );

    // Teacher A (matching owner_staff_id) succeeds even though created_by is different
    const verified = await assertUlanganOwnership(cbtDb, examId, userA);
    assert.equal(verified.exam.owner_staff_id, 'staff-teacher-a');
  });

  it('15. Ordinary-Teacher Baseline Access & Scope Separation', async () => {
    const { d1: cbtDb } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // Staff profiles:
    // 1. Teacher A (role 'teacher' in role_assignments, NO rows in cbt_permission_grants)
    // 2. Teacher C (role 'teacher', NO assignments in Mansatas)
    // 3. Proctor X (role 'proctor', NO teacher permissions)
    // 4. Admin (role 'admin')
    await cbtDb.prepare(`
      INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap) VALUES
        ('staff-teacher-a', 'user-guru-a', 'guru.a@mansatas.sch.id', 'Guru Matematika'),
        ('staff-teacher-c', 'user-guru-c', 'guru.c@mansatas.sch.id', 'Guru Tanpa Jadwal'),
        ('staff-proctor-x', 'user-proctor-x', 'proctor@mansatas.sch.id', 'Pengawas'),
        ('staff-admin', 'user-admin', 'admin@mansatas.sch.id', 'Administrator');
      INSERT INTO cbt_role_assignments (id, staff_id, role) VALUES
        ('r-a', 'staff-teacher-a', 'teacher'),
        ('r-c', 'staff-teacher-c', 'teacher'),
        ('r-x', 'staff-proctor-x', 'proctor'),
        ('r-adm', 'staff-admin', 'admin');
    `).run();

    const app = new Hono<{
      Bindings: { DB: any; MANSATAS_DB: any; RATE_LIMIT: any; R2: any; JWT_SECRET: string };
      Variables: any;
    }>();

    app.use('*', async (c, next) => {
      c.env = {
        DB: cbtDb,
        MANSATAS_DB: mansatasDb,
        RATE_LIMIT: createMockKV(),
        R2: createMockR2(),
        JWT_SECRET,
      };
      await next();
    });
    app.route('/api/ulangan', ulanganRoutes);

    // Tokens without permissions array (relying on baseline role capability)
    const tokenTeacherA = await makeStaffToken('staff-teacher-a', 'teacher');
    const tokenTeacherC = await makeStaffToken('staff-teacher-c', 'teacher');
    const tokenProctor = await makeStaffToken('staff-proctor-x', 'proctor');
    const tokenAdmin = await makeStaffToken('staff-admin', 'admin');

    // 1. Ordinary teacher with active assignment -> can enter Ulangan domain and see own assignments
    const resA = await app.request('/api/ulangan/teaching-assignments', {
      headers: { Authorization: `Bearer ${tokenTeacherA}` },
    });
    assert.equal(resA.status, 200);
    const bodyA = await resA.json<any>();
    assert.equal(bodyA.data.length, 2);
    assert.equal(bodyA.data[0].id, 'assign-a1');

    // Teacher A can create exam in own teaching scope
    const resCreateA = await app.request('/api/ulangan/exams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teaching_assignment_id: 'assign-a1', title: 'Ulangan Baseline Teacher A' }),
    });
    assert.equal(resCreateA.status, 201);
    const examIdA = (await resCreateA.json<any>()).data.id;

    // Teacher A CANNOT create exam using Teacher B's assignment (assign-b1) -> 400 Bad Request
    const resCreateWrong = await app.request('/api/ulangan/exams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teaching_assignment_id: 'assign-b1', title: 'Scope Violation' }),
    });
    assert.equal(resCreateWrong.status, 400);

    // 2. Teacher without assignment -> domain accessible but cannot create
    const resC = await app.request('/api/ulangan/teaching-assignments', {
      headers: { Authorization: `Bearer ${tokenTeacherC}` },
    });
    assert.equal(resC.status, 200);
    const bodyC = await resC.json<any>();
    assert.equal(bodyC.data.length, 0); // No assignments

    const resCreateC = await app.request('/api/ulangan/exams', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenTeacherC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teaching_assignment_id: 'assign-a1', title: 'Spoofed Assignment' }),
    });
    assert.equal(resCreateC.status, 400);

    // 3. Non-teacher staff without Ulangan capability -> rejected with 403 Forbidden
    const resProc = await app.request('/api/ulangan/teaching-assignments', {
      headers: { Authorization: `Bearer ${tokenProctor}` },
    });
    assert.equal(resProc.status, 403);

    // 4. Admin oversight -> works through explicit admin RBAC authority
    const resAdmin = await app.request(`/api/ulangan/exams/${examIdA}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    assert.equal(resAdmin.status, 200);
    const bodyAdmin = await resAdmin.json<any>();
    assert.equal(bodyAdmin.data.id, examIdA);
  });
});
