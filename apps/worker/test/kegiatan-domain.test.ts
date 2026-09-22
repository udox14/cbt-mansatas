// test/kegiatan-domain.test.ts
// Comprehensive Test Suite for Phase 3 — Kegiatan Domain

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';

import kegiatanRoutes from '../src/routes/domains/kegiatan.ts';
import { signJWT } from '../src/utils/jwt.ts';
import {
  listStudentsFromMansatas,
  getStudentFromMansatasById,
  listClassesFromMansatas,
  formatStudentClassName,
  normalizeStudentParticipant,
} from '../src/services/sources/students.ts';
import {
  listKegiatanEvents,
  getKegiatanEventById,
  createKegiatanEvent,
  updateKegiatanEvent,
  transitionKegiatanEventStatus,
  DomainMismatchError,
} from '../src/services/domains/kegiatan/events.ts';
import { checkKegiatanEventReadiness } from '../src/services/domains/kegiatan/readiness.ts';
import {
  listKegiatanEligibleStudents,
  listKegiatanEventRoster,
  batchSnapshotToKegiatanRoster,
  removeStudentFromKegiatanRoster,
} from '../src/services/domains/kegiatan/participants.ts';

// Helper to create test D1 database matching CBT schema
function createTestD1Database() {
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
      subject_id TEXT,
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

    CREATE TABLE cbt_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      question_order INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      question_type TEXT DEFAULT 'multiple_choice',
      points REAL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_question_options (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
      option_label TEXT NOT NULL,
      option_text TEXT NOT NULL,
      is_correct INTEGER DEFAULT 0,
      option_order INTEGER DEFAULT 0
    );

    CREATE TABLE cbt_exam_tokens (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
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
      room_id TEXT NOT NULL,
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

// Helper to create mock MANSATAS_DB matching authoritative Mansatas schema
function createMockMansatasDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
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

    -- Seed classes
    INSERT INTO kelas (id, tingkat, kelompok, nomor_kelas) VALUES
      ('k-10-mipa-1', 10, 'MIPA', 1),
      ('k-10-mipa-2', 10, 'MIPA', 2),
      ('k-11-ips-1', 11, 'IPS', 1),
      ('k-12-mipa-1', 12, 'MIPA', 1);

    -- Seed students
    INSERT INTO siswa (id, nisn, nis_lokal, nama_lengkap, jenis_kelamin, kelas_id, status) VALUES
      ('s-1', '0012345671', '2026101', 'Ahmad Dahlan', 'L', 'k-10-mipa-1', 'aktif'),
      ('s-2', '0012345672', '2026102', 'Budi Santoso', 'L', 'k-10-mipa-1', 'aktif'),
      ('s-3', '0012345673', '2026103', 'Citra Lestari', 'P', 'k-10-mipa-2', 'aktif'),
      ('s-4', '0012345674', '2026104', 'Dewi Sartika', 'P', 'k-11-ips-1', 'aktif'),
      ('s-5', '0012345675', '2026105', 'Eko Prasetyo', 'L', 'k-12-mipa-1', 'aktif'),
      ('s-6', '0012345676', '2026106', 'Fajar Sidik', 'L', 'k-12-mipa-1', 'nonaktif');
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

describe('Kegiatan Domain & Mansatas Student Adapter Suite', () => {
  const JWT_SECRET = 'super-secure-kegiatan-secret-key-1234567890';

  it('1. Mansatas Student Source Adapter: canonical schema mapping, current-class display, and filtering', async () => {
    const { d1: mansatasDb } = createMockMansatasDb();

    // Verify formatStudentClassName
    assert.equal(formatStudentClassName(10, 'MIPA', 1), '10 MIPA 1');
    assert.equal(formatStudentClassName('XII', null, 2), 'XII 2');
    assert.equal(formatStudentClassName(null, null, null), '');

    // List classes
    const classes = await listClassesFromMansatas(mansatasDb);
    assert.equal(classes.length, 4);
    assert.equal(classes[0].name, '10 MIPA 1');

    // List active students (default is_active: true filters out s-6)
    const activeStudents = await listStudentsFromMansatas(mansatasDb);
    assert.equal(activeStudents.total, 5);
    assert.equal(activeStudents.items.length, 5);
    assert.equal(activeStudents.items[0].full_name, 'Ahmad Dahlan');
    assert.equal(activeStudents.items[0].class_name, '10 MIPA 1');
    assert.equal(activeStudents.items[0].source_key, 'mansatas');

    // Filter by grade
    const grade10 = await listStudentsFromMansatas(mansatasDb, { grade: '10' });
    assert.equal(grade10.total, 3);

    // Filter by gender
    const female = await listStudentsFromMansatas(mansatasDb, { gender: 'P' });
    assert.equal(female.total, 2);

    // Filter by search query
    const searchAhmad = await listStudentsFromMansatas(mansatasDb, { q: 'ahmad' });
    assert.equal(searchAhmad.total, 1);
    assert.equal(searchAhmad.items[0].nisn, '0012345671');

    // Get single student by ID
    const single = await getStudentFromMansatasById(mansatasDb, 's-3');
    assert.ok(single);
    assert.equal(single?.full_name, 'Citra Lestari');
    assert.equal(single?.class_name, '10 MIPA 2');
  });

  it('2. Domain Isolation: rejects PMB, TKA, Semester, and Ulangan events on Kegiatan operations', async () => {
    const { d1 } = createTestD1Database();

    // Populate non-kegiatan events
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-pmb', 'PMB-2026', 'PMB', 'pmb', 'active')").bind().run();
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-tka', 'TKA-2026', 'TKA', 'tka', 'active')").bind().run();
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-pas', 'PAS-2026', 'PAS', 'semester', 'active')").bind().run();
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-uh', 'UH-2026', 'UH', 'ulangan', 'active')").bind().run();

    // Populate legitimate kegiatan event
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-kegiatan', 'OSN-2026', 'Seleksi OSN', 'kegiatan', 'draft')").bind().run();

    // Legitimate Kegiatan event is retrieved
    const kegEvent = await getKegiatanEventById(d1, 'ev-kegiatan');
    assert.ok(kegEvent);
    assert.equal(kegEvent?.code, 'OSN-2026');

    // PMB event is strictly rejected with DomainMismatchError
    await assert.rejects(async () => {
      await getKegiatanEventById(d1, 'ev-pmb');
    }, DomainMismatchError);

    // TKA event rejected
    await assert.rejects(async () => {
      await getKegiatanEventById(d1, 'ev-tka');
    }, DomainMismatchError);

    // Semester event rejected
    await assert.rejects(async () => {
      await getKegiatanEventById(d1, 'ev-pas');
    }, DomainMismatchError);

    // Ulangan event rejected
    await assert.rejects(async () => {
      await getKegiatanEventById(d1, 'ev-uh');
    }, DomainMismatchError);

    // Update on non-kegiatan event is rejected
    await assert.rejects(async () => {
      await updateKegiatanEvent(d1, 'ev-pmb', { name: 'PMB Hacked' });
    }, DomainMismatchError);

    // Status transition on non-kegiatan event is rejected
    await assert.rejects(async () => {
      await transitionKegiatanEventStatus(d1, 'ev-tka', 'ready');
    }, DomainMismatchError);
  });

  it('3. Canonical Lifecycle Reuse & Rollback Support', async () => {
    const { d1 } = createTestD1Database();

    // Create Kegiatan event in draft
    const created = await createKegiatanEvent(d1, {
      code: 'LOMBA-01',
      name: 'Lomba Matematika',
      participant_source: 'mansatas',
      status: 'draft',
    }, 'admin-1');
    assert.equal(created.success, true);
    const eventId = created.id!;

    // Forward: draft -> configuration
    const toConfig = await transitionKegiatanEventStatus(d1, eventId, 'configuration');
    assert.equal(toConfig.success, true);

    // Rollback: configuration -> draft
    const rollToDraft = await transitionKegiatanEventStatus(d1, eventId, 'draft');
    assert.equal(rollToDraft.success, true);

    // Return to configuration
    await transitionKegiatanEventStatus(d1, eventId, 'configuration');

    // Illegal jump: configuration -> active (REJECTED by canonical validator)
    const illegalJump = await transitionKegiatanEventStatus(d1, eventId, 'active');
    assert.equal(illegalJump.success, false);
    assert.match(illegalJump.error || '', /tidak diizinkan/);

    // Illegal jump: configuration -> archived (REJECTED: archived only from completed)
    const illegalArchive = await transitionKegiatanEventStatus(d1, eventId, 'archived');
    assert.equal(illegalArchive.success, false);
    assert.match(illegalArchive.error || '', /hanya diizinkan dari status 'completed'|tidak diizinkan/);
  });

  it('4. Deterministic Readiness Gate: blocks configuration -> ready until criteria are met', async () => {
    const { d1 } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // 1. Create Kegiatan event in configuration
    const created = await createKegiatanEvent(d1, {
      code: 'OMI-2026',
      name: 'Olimpiade Madrasah Indonesia',
      participant_source: 'mansatas',
      status: 'configuration',
    }, 'admin-1');
    const eventId = created.id!;

    // Step A: Readiness check with no exams
    const check1 = await checkKegiatanEventReadiness(d1, eventId);
    assert.equal(check1.ready, false);
    const examCheck = check1.checks.find((c) => c.key === 'exams');
    assert.equal(examCheck?.ok, false);

    // Attempting transition to ready must be BLOCKED
    const blocked1 = await transitionKegiatanEventStatus(d1, eventId, 'ready');
    assert.equal(blocked1.success, false);
    assert.match(blocked1.error || '', /Kegiatan belum siap/);

    // Step B: Add an exam without questions
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode, active_status) VALUES ('exam-omi-01', 'OMI Matematika', ?, 'kegiatan', 'draft')")
      .bind(eventId).run();

    const check2 = await checkKegiatanEventReadiness(d1, eventId);
    assert.equal(check2.ready, false);
    const qCheck = check2.checks.find((c) => c.key === 'questions');
    assert.equal(qCheck?.ok, false);

    // Step C: Add a valid question with correct option
    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_order, question_text, points, question_type) VALUES ('q-1', 'exam-omi-01', 1, 'Berapa 2+2?', 1, 'multiple_choice')").bind().run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt-1', 'q-1', 'A', '4', 1)").bind().run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt-2', 'q-1', 'B', '5', 0)").bind().run();

    const check3 = await checkKegiatanEventReadiness(d1, eventId);
    assert.equal(check3.ready, false);
    const partCheck = check3.checks.find((c) => c.key === 'participants');
    assert.equal(partCheck?.ok, false);

    // Step D: Snapshot explicit participant into roster (one event / one exam / roster exists -> pass)
    const rosterRes = await batchSnapshotToKegiatanRoster(d1, mansatasDb, eventId, 'exam-omi-01', ['s-1', 's-2']);
    assert.equal(rosterRes.added, 2);

    const check1Exam = await checkKegiatanEventReadiness(d1, eventId);
    assert.equal(check1Exam.ready, true);
    assert.equal(check1Exam.checks.find((c) => c.key === 'participants')?.ok, true);

    // Step E: Add second exam without participants (one event / two exams / roster only on first -> fail)
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode, active_status) VALUES ('exam-omi-02', 'OMI Fisika', ?, 'kegiatan', 'draft')")
      .bind(eventId).run();
    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_order, question_text, points, question_type) VALUES ('q-2', 'exam-omi-02', 1, 'Berapa gravitasi bumi?', 1, 'multiple_choice')").bind().run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt-21', 'q-2', 'A', '9.8 m/s2', 1)").bind().run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt-22', 'q-2', 'B', '15 m/s2', 0)").bind().run();

    const check2ExamsUnfilled = await checkKegiatanEventReadiness(d1, eventId);
    assert.equal(check2ExamsUnfilled.ready, false, 'Readiness must fail when an exam has zero roster participants');
    const partCheckMulti = check2ExamsUnfilled.checks.find((c) => c.key === 'participants');
    assert.equal(partCheckMulti?.ok, false);
    assert.equal(partCheckMulti?.message, 'Masih ada ujian tanpa peserta');
    assert.ok(Array.isArray(partCheckMulti?.details));
    const missingExam = (partCheckMulti?.details as any[]).find((e) => e.exam_id === 'exam-omi-02');
    assert.ok(missingExam);
    assert.equal(missingExam.participant_count, 0);

    // Step F: Snapshot roster for second exam (roster added to second -> pass)
    const rosterRes2 = await batchSnapshotToKegiatanRoster(d1, mansatasDb, eventId, 'exam-omi-02', ['s-3']);
    assert.equal(rosterRes2.added, 1);

    // Now all criteria are met across all exams!
    const checkFinal = await checkKegiatanEventReadiness(d1, eventId);
    assert.equal(checkFinal.ready, true);
    assert.equal(checkFinal.checks.find((c) => c.key === 'event_config')?.ok, true);
    assert.equal(checkFinal.checks.find((c) => c.key === 'exams')?.ok, true);
    assert.equal(checkFinal.checks.find((c) => c.key === 'questions')?.ok, true);
    assert.equal(checkFinal.checks.find((c) => c.key === 'participants')?.ok, true);

    // Now transition to ready SUCCEEDS
    const transitionSuccess = await transitionKegiatanEventStatus(d1, eventId, 'ready');
    assert.equal(transitionSuccess.success, true);

    // Rollback from ready -> configuration is supported
    const rollback = await transitionKegiatanEventStatus(d1, eventId, 'configuration');
    assert.equal(rollback.success, true);
  });

  it('5. Roster Mutation: explicit IDs, duplicate prevention, ownership validation, session protection', async () => {
    const { d1 } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // Setup event & exam
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-lomba', 'LOMBA-IPA', 'Lomba IPA', 'kegiatan', 'configuration')").bind().run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode, active_status) VALUES ('ex-ipa-1', 'IPA Teori', 'ev-lomba', 'kegiatan', 'draft')").bind().run();

    // 1. Rejects empty student_ids
    await assert.rejects(async () => {
      await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-lomba', 'ex-ipa-1', []);
    }, /Daftar ID siswa wajib disertakan/);

    // 2. Rejects exam not belonging to event
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-other', 'OTHER-01', 'Other Event', 'kegiatan', 'configuration')").bind().run();
    await assert.rejects(async () => {
      await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-other', 'ex-ipa-1', ['s-1']);
    }, /tidak terdaftar pada kegiatan/);

    // 3. Snapshot explicit students (s-1, s-2)
    const result1 = await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-lomba', 'ex-ipa-1', ['s-1', 's-2']);
    assert.equal(result1.matched, 2);
    assert.equal(result1.added, 2);
    assert.equal(result1.skipped, 0);

    // 4. Duplicate prevention: snapshotting same students again skips duplicates
    const result2 = await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-lomba', 'ex-ipa-1', ['s-1', 's-2', 's-3']);
    assert.equal(result2.matched, 3);
    assert.equal(result2.added, 1); // Only s-3 was new
    assert.equal(result2.skipped, 2); // s-1 and s-2 were skipped

    // 5. Remove student before exam starts succeeds
    const rosterRows = await listKegiatanEventRoster(d1, 'ev-lomba', 'ex-ipa-1');
    assert.equal(rosterRows.length, 3);
    const s3Roster = rosterRows.find((r) => r.source_id === 's-3');
    assert.ok(s3Roster);

    const removeSuccess = await removeStudentFromKegiatanRoster(d1, 'ev-lomba', 'ex-ipa-1', s3Roster.id);
    assert.equal(removeSuccess.success, true);

    // 6. Attempted removal after session has started is REJECTED
    const s1Roster = rosterRows.find((r) => r.source_id === 's-1');
    assert.ok(s1Roster);
    // Student s-1 starts a session
    await d1.prepare("INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status) VALUES ('sess-s1', 'ex-ipa-1', 's-1', 'mansatas', 'room-1', 'active')").bind().run();

    const removeBlocked = await removeStudentFromKegiatanRoster(d1, 'ev-lomba', 'ex-ipa-1', s1Roster.id);
    assert.equal(removeBlocked.success, false);
    assert.match(removeBlocked.error || '', /sesi ujian telah dibuat atau selesai/);
  });

  it('6. Distinct Event-Level Participant Counting', async () => {
    const { d1 } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // Event with 2 exams
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-multi', 'MULTI-EXAM', 'Multi Exam Event', 'kegiatan', 'configuration')").bind().run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode) VALUES ('ex-1', 'Mapel 1', 'ev-multi', 'kegiatan')").bind().run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode) VALUES ('ex-2', 'Mapel 2', 'ev-multi', 'kegiatan')").bind().run();

    // Assign student s-1 and s-2 to Exam 1
    await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-multi', 'ex-1', ['s-1', 's-2']);

    // Assign student s-1 (same student!) and s-3 to Exam 2
    await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-multi', 'ex-2', ['s-1', 's-3']);

    // Event listing must report DISTINCT participants: 3 (s-1, s-2, s-3), NOT 4!
    const events = await listKegiatanEvents(d1);
    const ev = events.find((e) => e.id === 'ev-multi');
    assert.ok(ev);
    assert.equal(ev?.exam_count, 2);
    assert.equal(ev?.roster_count, 3, 'Event-level roster count must be distinct across exams');
  });

  it('7. HTTP API Contracts, RBAC & End-to-End Shared Engine Delegation', async () => {
    const { d1 } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    // Setup Hono app with Kegiatan routes
    const app = new Hono<{ Bindings: any }>();
    app.route('/api/kegiatan', kegiatanRoutes);

    const env = {
      DB: d1,
      MANSATAS_DB: mansatasDb,
      JWT_SECRET,
    };

    // Helper to generate auth tokens
    const adminToken = await signJWT({
      sub: 'admin-uid',
      username: 'admin@madrasah.sch.id',
      role: 'admin',
      roles: ['admin'],
      permissions: ['*'],
      allowed_modes: ['kegiatan'],
    }, JWT_SECRET);

    const studentToken = await signJWT({
      sub: 's-1',
      username: '0012345671',
      role: 'student',
      roles: ['student'],
      permissions: [],
      allowed_modes: ['kegiatan'],
    }, JWT_SECRET);

    const unauthorizedStaffToken = await signJWT({
      sub: 'staff-unauth',
      username: 'guru@madrasah.sch.id',
      role: 'guru',
      roles: ['guru'],
      permissions: ['ulangan.*'],
      allowed_modes: ['kegiatan'], // Mode visibility alone must NOT grant management
    }, JWT_SECRET);

    // Negative Authorization 1: 401 Unauthenticated
    const resNoAuth = await app.request('/api/kegiatan/events', { method: 'GET' }, env);
    assert.equal(resNoAuth.status, 401);

    // Negative Authorization 2: 403 Student rejected
    const resStudent = await app.request('/api/kegiatan/events', {
      method: 'GET',
      headers: { Authorization: `Bearer ${studentToken}` },
    }, env);
    assert.equal(resStudent.status, 403);

    // Negative Authorization 3: 403 Mode visibility alone without permission rejected
    const resUnauthStaff = await app.request('/api/kegiatan/events', {
      method: 'GET',
      headers: { Authorization: `Bearer ${unauthorizedStaffToken}` },
    }, env);
    assert.equal(resUnauthStaff.status, 403);

    // Positive Authorization: 200 Admin allowed
    const resAdminList = await app.request('/api/kegiatan/events', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, env);
    assert.equal(resAdminList.status, 200);

    // POST /api/kegiatan/events: Create event
    const resCreate = await app.request('/api/kegiatan/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: 'TRYOUT-01',
        name: 'Try Out Mandiri 2026',
        description: 'Try Out Persiapan Ujian',
      }),
    }, env);
    assert.equal(resCreate.status, 201);
    const createData = await resCreate.json() as any;
    const eventId = createData.data.id;
    assert.ok(eventId);

    // POST /api/kegiatan/events/:eventId/exams: Delegate exam creation to shared engine
    const resCreateExam = await app.request(`/api/kegiatan/events/${eventId}/exams`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Try Out Bahasa Indonesia',
        duration_minutes: 90,
      }),
    }, env);
    assert.equal(resCreateExam.status, 201);
    const examData = await resCreateExam.json() as any;
    const examId = examData.data.id;
    assert.ok(examId);

    // Verify mode is derived strictly from parent event ('kegiatan')
    const savedExam = await d1.prepare('SELECT mode, event_id FROM cbt_exams WHERE id = ?').bind(examId).first<any>();
    assert.equal(savedExam.mode, 'kegiatan');
    assert.equal(savedExam.event_id, eventId);

    // POST /api/kegiatan/events/:eventId/exams/:examId/roster: Explicit student snapshot
    const resRoster = await app.request(`/api/kegiatan/events/${eventId}/exams/${examId}/roster`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        student_ids: ['s-1', 's-2'],
      }),
    }, env);
    assert.equal(resRoster.status, 200);
    const rosterData = await resRoster.json() as any;
    assert.equal(rosterData.data.added, 2);

    // GET /api/kegiatan/events/:eventId/roster: Retrieve roster
    const resGetRoster = await app.request(`/api/kegiatan/events/${eventId}/roster`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, env);
    assert.equal(resGetRoster.status, 200);
    const getRosterData = await resGetRoster.json() as any;
    assert.equal(getRosterData.data.length, 2);

    // GET /api/kegiatan/classes: List Mansatas classes
    const resClasses = await app.request('/api/kegiatan/classes', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    }, env);
    assert.equal(resClasses.status, 200);
    const classesData = await resClasses.json() as any;
    assert.equal(classesData.data.length, 4);
  });

  it('8. Large Explicit-ID Snapshotting D1-Safe (>100 IDs Chunking)', async () => {
    const { d1 } = createTestD1Database();
    const { sqlite: mansatasSqlite, d1: mansatasDb } = createMockMansatasDb();

    // Insert 200 distinct students into mock Mansatas DB (s-bulk-1 to s-bulk-200)
    const totalStudents = 200;
    const testIds: string[] = [];
    for (let i = 1; i <= totalStudents; i++) {
      const id = `s-bulk-${i}`;
      testIds.push(id);
      mansatasSqlite.exec(`
        INSERT INTO siswa (id, nisn, nis_lokal, nama_lengkap, jenis_kelamin, kelas_id, status)
        VALUES ('${id}', '9999${String(i).padStart(4, '0')}', 'NIS-${i}', 'Siswa Bulk ${i}', 'L', 'k-10-mipa-1', 'aktif');
      `);
    }

    // Setup event and exam
    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-bulk', 'BULK-TEST', 'Bulk Snapshot Event', 'kegiatan', 'configuration')").bind().run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode) VALUES ('ex-bulk-1', 'Bulk Exam', 'ev-bulk', 'kegiatan')").bind().run();

    // Verify listStudentsFromMansatas resolves 200 IDs cleanly using chunking (staying below 100 parameters)
    const resolved = await listStudentsFromMansatas(mansatasDb, {}, testIds);
    assert.equal(resolved.items.length, 200, 'All 200 students must be resolved through chunked queries');
    assert.equal(resolved.total, 200);

    // Snapshot all 200 students into cbt_exam_roster
    const snapshotRes = await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-bulk', 'ex-bulk-1', testIds);
    assert.equal(snapshotRes.matched, 200);
    assert.equal(snapshotRes.added, 200, 'All 200 snapshots must be inserted without parameter limit failures');
    assert.equal(snapshotRes.skipped, 0);

    // Verify 200 rows exist in cbt_exam_roster
    const rosterList = await listKegiatanEventRoster(d1, 'ev-bulk', 'ex-bulk-1');
    assert.equal(rosterList.length, 200);

    // Re-snapshot same 200 IDs: duplicate prevention must skip all 200
    const dupeRes = await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-bulk', 'ex-bulk-1', testIds);
    assert.equal(dupeRes.matched, 200);
    assert.equal(dupeRes.added, 0);
    assert.equal(dupeRes.skipped, 200);

    // Roster count remains exactly 200 (no duplicate rows)
    const rosterListAfterDupe = await listKegiatanEventRoster(d1, 'ev-bulk', 'ex-bulk-1');
    assert.equal(rosterListAfterDupe.length, 200);

    // Enforces maximum operational cap (1,000 IDs)
    const oversizedIds = Array.from({ length: 1001 }, (_, i) => `s-over-${i}`);
    await assert.rejects(async () => {
      await batchSnapshotToKegiatanRoster(d1, mansatasDb, 'ev-bulk', 'ex-bulk-1', oversizedIds);
    }, /Maksimal 1\.000 siswa per operasi snapshot/);
  });

  it('9. Positive Non-Admin RBAC Grants with Real Permission Table Mechanism', async () => {
    const { d1 } = createTestD1Database();
    const { d1: mansatasDb } = createMockMansatasDb();

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/kegiatan', kegiatanRoutes);

    const env = {
      DB: d1,
      MANSATAS_DB: mansatasDb,
      JWT_SECRET,
    };

    // Ordinary teacher staff identity (NOT role admin, NO wildcard in token)
    const staffId = 'staff-guru-42';
    const teacherToken = await signJWT({
      sub: staffId,
      staff_id: staffId,
      username: 'guru42@madrasah.sch.id',
      role: 'teacher',
      roles: ['teacher'],
      // Token permissions empty; must evaluate authoritatively against cbt_permission_grants
      permissions: [],
      allowed_modes: ['kegiatan'],
    }, JWT_SECRET);

    // Step A: Initially without grants -> 403
    const resNoGrant = await app.request('/api/kegiatan/events', {
      method: 'GET',
      headers: { Authorization: `Bearer ${teacherToken}` },
    }, env);
    assert.equal(resNoGrant.status, 403, 'Staff without grants must be rejected with 403');

    // Step B: Grant 'kegiatan.event.read' in cbt_permission_grants
    await d1.prepare(
      `INSERT INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value)
       VALUES ('grant-1', ?, 'kegiatan.event.read', 'mode', 'kegiatan')`
    ).bind(staffId).run();

    // Can read events
    const resRead = await app.request('/api/kegiatan/events', {
      method: 'GET',
      headers: { Authorization: `Bearer ${teacherToken}` },
    }, env);
    assert.equal(resRead.status, 200, 'Staff with kegiatan.event.read can list events');

    // Cannot create event
    const resCreateForbidden = await app.request('/api/kegiatan/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'GURU-01', name: 'Kegiatan Guru' }),
    }, env);
    assert.equal(resCreateForbidden.status, 403, 'Staff without kegiatan.event.create cannot create event');

    // Step C: Additionally grant 'kegiatan.event.create'
    await d1.prepare(
      `INSERT INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value)
       VALUES ('grant-2', ?, 'kegiatan.event.create', 'mode', 'kegiatan')`
    ).bind(staffId).run();

    const resCreateAllowed = await app.request('/api/kegiatan/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: 'GURU-01', name: 'Kegiatan Guru' }),
    }, env);
    assert.equal(resCreateAllowed.status, 201, 'Staff with kegiatan.event.create can create event');
    const createdEvent = await resCreateAllowed.json() as any;
    const eventId = createdEvent.data.id;

    // Cannot transition status (still lacks kegiatan.event.transition)
    const resTransitionForbidden = await app.request(`/api/kegiatan/events/${eventId}/status`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'configuration' }),
    }, env);
    assert.equal(resTransitionForbidden.status, 403, 'Staff without transition grant cannot change status');

    // Step D: Roster management permission
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode) VALUES ('ex-guru-1', 'Ujian Guru', ?, 'kegiatan')")
      .bind(eventId).run();

    // Try snapshotting roster WITHOUT kegiatan.roster.manage -> 403
    const resRosterForbidden = await app.request(`/api/kegiatan/events/${eventId}/exams/ex-guru-1/roster`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ student_ids: ['s-1'] }),
    }, env);
    assert.equal(resRosterForbidden.status, 403, 'Staff without kegiatan.roster.manage cannot snapshot roster');

    // Grant 'kegiatan.roster.manage'
    await d1.prepare(
      `INSERT INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value)
       VALUES ('grant-3', ?, 'kegiatan.roster.manage', 'mode', 'kegiatan')`
    ).bind(staffId).run();

    const resRosterAllowed = await app.request(`/api/kegiatan/events/${eventId}/exams/ex-guru-1/roster`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ student_ids: ['s-1'] }),
    }, env);
    assert.equal(resRosterAllowed.status, 200, 'Staff with kegiatan.roster.manage can snapshot roster');
  });

  it('10. Canonical Kegiatan UI Navigation Verification', () => {
    const webRoot = fs.existsSync(path.resolve(process.cwd(), '../web'))
      ? path.resolve(process.cwd(), '../web')
      : path.resolve(process.cwd(), 'apps/web');

    // 1. Verify Mode Launcher points Kegiatan to /kegiatan
    const selectModePath = path.resolve(webRoot, 'src/app/app/select-mode/page.tsx');
    const selectModeContent = fs.readFileSync(selectModePath, 'utf8');
    assert.match(selectModeContent, /id:\s*'kegiatan'/);
    assert.match(selectModeContent, /targetUrl:\s*'\/kegiatan'/);

    // 2. Verify Admin Page points Kegiatan menu to /kegiatan and does not import or render KegiatanPage
    const adminPagePath = path.resolve(webRoot, 'src/app/admin/page.tsx');
    const adminPageContent = fs.readFileSync(adminPagePath, 'utf8');
    assert.doesNotMatch(adminPageContent, /import\s+{[^}]*KegiatanPage[^}]*}\s+from/);
    assert.doesNotMatch(adminPageContent, /<KegiatanPage/);
    assert.match(adminPageContent, /window\.location\.href\s*=\s*'\/kegiatan'/);

    // 3. Verify EventManagementPage does not export KegiatanPage alias
    const eventMgmtPath = path.resolve(webRoot, 'src/features/platform/events/EventManagementPage.tsx');
    const eventMgmtContent = fs.readFileSync(eventMgmtPath, 'utf8');
    assert.doesNotMatch(eventMgmtContent, /export\s+const\s+KegiatanPage/);
  });
});
