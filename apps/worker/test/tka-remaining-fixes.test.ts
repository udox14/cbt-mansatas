// ============================================================
// Phase 5 — Verification Suite for 3 Remaining Data/Security Issues
//
// 1. Existing-Database validation_status CHECK Migration & Room FK Semantics
// 2. Generic/Shared TKA Structural Mutation Bypasses & Trigger Safety
// 3. Narrowed tka.results.read RBAC Authority vs tka.access
// ============================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';

import tkaRoutes from '../src/routes/domains/tka.ts';
import { authoringRoutes } from '../src/routes/exam-engine/authoring.ts';
import { signJWT } from '../src/utils/jwt.ts';
import { createTkaEvent, transitionTkaEventStatus } from '../src/services/domains/tka/events.ts';
import { createTkaExam, deleteTkaExam } from '../src/services/domains/tka/exams.ts';
import { createExam, updateExam, deleteExam } from '../src/services/exam-engine/exams.ts';
import { authMiddleware } from '../src/middleware/auth.ts';

const JWT_SECRET = 'test-secret-key-remaining-fixes';

function createMockCbtDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

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

    CREATE TRIGGER trg_cbt_exams_tka_subject_insert
    BEFORE INSERT ON cbt_exams
    WHEN NEW.mode = 'tka' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
    BEGIN
      SELECT RAISE(ABORT, 'TKA exams must have a non-null verified subject_id');
    END;

    CREATE TRIGGER trg_cbt_exams_tka_subject_update
    BEFORE UPDATE OF subject_id, mode ON cbt_exams
    WHEN NEW.mode = 'tka' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
    BEGIN
      SELECT RAISE(ABORT, 'TKA exams must have a non-null verified subject_id');
    END;

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
      room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL,
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

    CREATE TABLE cbt_exam_sessions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL DEFAULT 'mansatas',
      room_id TEXT REFERENCES cbt_rooms(id),
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

    CREATE TABLE cbt_exam_assignments (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL DEFAULT 'pendaftar',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_permission_grants (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_value TEXT NOT NULL DEFAULT '*',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(staff_id, permission, scope_type, scope_value)
    );
  `);

  return {
    rawSqlite: sqlite,
    d1: wrapSqliteAsD1(sqlite),
  };
}

function createMockMansatasDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE tahun_ajaran (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE mata_pelajaran (
      id TEXT PRIMARY KEY,
      nama_mapel TEXT NOT NULL
    );

    INSERT INTO tahun_ajaran (id, nama, is_active)
    VALUES ('ta-2026', '2025/2026', 1);

    INSERT INTO mata_pelajaran (id, nama_mapel) VALUES
      ('mp-mat', 'Matematika'),
      ('mp-ind', 'Bahasa Indonesia'),
      ('mp-ing', 'Bahasa Inggris'),
      ('mp-fis', 'Fisika'),
      ('mp-kim', 'Kimia'),
      ('mp-bio', 'Biologi'),
      ('mp-eko', 'Ekonomi'),
      ('mp-geo', 'Geografi'),
      ('mp-sos', 'Sosiologi'),
      ('mp-pjok', 'Pendidikan Jasmani Olahraga dan Kesehatan'),
      ('mp-sbk', 'Seni Budaya');
  `);

  return wrapSqliteAsD1(sqlite);
}

function wrapSqliteAsD1(sqlite: DatabaseSync): any {
  return {
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async first<T = any>(col?: string): Promise<T | null> {
              const stmt = sqlite.prepare(sql);
              const row = stmt.get(...params) as any;
              if (!row) return null;
              if (col) return row[col] ?? null;
              return row as T;
            },
            async all<T = any>(): Promise<{ results: T[] }> {
              const stmt = sqlite.prepare(sql);
              const rows = stmt.all(...params) as T[];
              return { results: rows };
            },
            async run(): Promise<{ success: boolean; meta: any }> {
              const stmt = sqlite.prepare(sql);
              const info = stmt.run(...params);
              return { success: true, meta: info };
            },
          };
        },
        async first<T = any>(col?: string): Promise<T | null> {
          return this.bind().first(col);
        },
        async all<T = any>(): Promise<{ results: T[] }> {
          return this.bind().all();
        },
        async run(): Promise<{ success: boolean; meta: any }> {
          return this.bind().run();
        },
      };
    },
    async batch(statements: any[]): Promise<any[]> {
      const results = [];
      for (const s of statements) {
        results.push(await s.run());
      }
      return results;
    },
  };
}

describe('Phase 5 — Remaining 3 Data/Security Issues Verification', () => {
  // ── ISSUE 1: Existing-Database validation_status CHECK Migration ─
  describe('Issue 1: Existing-Database validation_status CHECK Migration', () => {
    it('1.1 Proves D1 table rebuild migration safely transforms pre-closure database, preserves data and room FK semantics', () => {
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec('PRAGMA foreign_keys = ON;');

      // Setup pre-closure schema: cbt_tka_participants WITHOUT CHECK constraint
      sqlite.exec(`
        CREATE TABLE cbt_events (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          mode TEXT NOT NULL DEFAULT 'tka',
          status TEXT NOT NULL DEFAULT 'draft'
        );

        CREATE TABLE cbt_rooms (
          id TEXT PRIMARY KEY,
          room_name TEXT NOT NULL
        );

        CREATE TABLE cbt_exams (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          event_id TEXT REFERENCES cbt_events(id),
          mode TEXT,
          subject_id TEXT
        );

        -- Pre-closure table WITHOUT CHECK constraint
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
          validation_status TEXT NOT NULL,
          validation_notes TEXT,
          room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(event_id, student_id)
        );

        INSERT INTO cbt_events (id, code, name) VALUES ('ev-1', 'TKA-01', 'Event 1');
        INSERT INTO cbt_rooms (id, room_name) VALUES ('r-101', 'Ruang 101');

        INSERT INTO cbt_tka_participants (
          id, event_id, student_id, nama_lengkap, validation_status, room_id
        ) VALUES
          ('p-1', 'ev-1', 's-1', 'Ahmad Fauzi', 'valid', 'r-101'),
          ('p-2', 'ev-1', 's-2', 'Siti Aminah', 'pending', 'r-101');
      `);

      // Verify pre-closure status has no CHECK constraint
      const preSql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cbt_tka_participants'").get() as any;
      assert.ok(!preSql.sql.includes('CHECK (validation_status IN'));

      // Read and execute migration-phase5-closure.sql
      const migrationFile = resolve(__dirname, '../migration-phase5-closure.sql');
      const migrationSql = readFileSync(migrationFile, 'utf8');
      sqlite.exec(migrationSql);

      // Verify post-migration table schema contains the CHECK constraint
      const postSql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cbt_tka_participants'").get() as any;
      assert.ok(postSql.sql.includes("CHECK (validation_status IN ('valid', 'missing_option', 'duplicate_option', 'duplicate_mandatory', 'unresolved', 'pending'))"));
      assert.ok(postSql.sql.includes('room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL'));

      // Verify existing rows survived intact
      const rows = sqlite.prepare('SELECT id, nama_lengkap, validation_status, room_id FROM cbt_tka_participants ORDER BY id').all() as any[];
      assert.equal(rows.length, 2);
      assert.equal(rows[0].id, 'p-1');
      assert.equal(rows[0].nama_lengkap, 'Ahmad Fauzi');
      assert.equal(rows[0].validation_status, 'valid');
      assert.equal(rows[0].room_id, 'r-101');

      assert.equal(rows[1].id, 'p-2');
      assert.equal(rows[1].nama_lengkap, 'Siti Aminah');
      assert.equal(rows[1].validation_status, 'pending');
      assert.equal(rows[1].room_id, 'r-101');

      // Verify foreign key integrity
      const fkCheck = sqlite.prepare('PRAGMA foreign_key_check;').all();
      assert.equal(fkCheck.length, 0);

      // Verify room ON DELETE SET NULL behavior
      sqlite.exec("DELETE FROM cbt_rooms WHERE id = 'r-101';");
      const postRoomRows = sqlite.prepare('SELECT room_id FROM cbt_tka_participants').all() as any[];
      assert.equal(postRoomRows[0].room_id, null);
      assert.equal(postRoomRows[1].room_id, null);
      const fkCheckPostRoom = sqlite.prepare('PRAGMA foreign_key_check;').all();
      assert.equal(fkCheckPostRoom.length, 0);
    });

    it('1.2 Proves SQLite strictly rejects invalid raw validation_status inserts and updates', () => {
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec('PRAGMA foreign_keys = ON;');

      const migrationFile = resolve(__dirname, '../migration-phase5-closure.sql');
      const migrationSql = readFileSync(migrationFile, 'utf8');

      sqlite.exec(`
        CREATE TABLE cbt_events (id TEXT PRIMARY KEY, code TEXT, name TEXT);
        CREATE TABLE cbt_rooms (id TEXT PRIMARY KEY, room_name TEXT);
        CREATE TABLE cbt_exams (id TEXT PRIMARY KEY, event_id TEXT, mode TEXT, subject_id TEXT);
        INSERT INTO cbt_events VALUES ('ev-1', 'TKA-01', 'Event 1');
      `);

      sqlite.exec(migrationSql);

      // Direct invalid INSERT must fail
      assert.throws(() => {
        sqlite.exec(`
          INSERT INTO cbt_tka_participants (id, event_id, student_id, nama_lengkap, validation_status)
          VALUES ('p-inv', 'ev-1', 's-inv', 'Invalid Student', 'invalid_status_test');
        `);
      }, /CHECK constraint failed/);

      // Valid insert followed by invalid UPDATE must fail
      sqlite.exec(`
        INSERT INTO cbt_tka_participants (id, event_id, student_id, nama_lengkap, validation_status)
        VALUES ('p-val', 'ev-1', 's-val', 'Valid Student', 'valid');
      `);

      assert.throws(() => {
        sqlite.exec(`
          UPDATE cbt_tka_participants SET validation_status = 'invalid_status_test' WHERE id = 'p-val';
        `);
      }, /CHECK constraint failed/);
    });
  });

  // ── ISSUE 2: Generic/Shared TKA Structural Mutation Bypasses ────
  describe('Issue 2: Generic & Shared Exam Structural Invariants & Bypass Protection', () => {
    let cbtWrapper: ReturnType<typeof createMockCbtDb>;
    let d1: any;
    let mansatasDb: any;

    function reset() {
      cbtWrapper = createMockCbtDb();
      d1 = cbtWrapper.d1;
      mansatasDb = createMockMansatasDb();
    }

    it('2.1 /api/tka valid subject creation succeeds', async () => {
      reset();
      const ev = await createTkaEvent(d1, mansatasDb, { code: 'TKA-EX', name: 'TKA Exam Test', academic_year_id: 'ta-2026' }, 'admin-1');
      const eventId = ev.id!;

      const res = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis', title: 'TKA Fisika' }, 'admin-1');
      assert.ok(res.success);
      assert.ok(res.id);

      const examRow = await d1.prepare('SELECT subject_id, mode FROM cbt_exams WHERE id = ?').bind(res.id).first<any>();
      assert.equal(examRow.subject_id, 'mp-fis');
      assert.equal(examRow.mode, 'tka');
    });

    it('2.2 Generic/admin attempt to create TKA exam without subject is rejected', async () => {
      reset();
      const ev = await createTkaEvent(d1, mansatasDb, { code: 'TKA-GEN1', name: 'TKA Gen 1', academic_year_id: 'ta-2026' }, 'admin-1');
      const eventId = ev.id!;

      // Call createExam directly without subject_id
      const res = await createExam(d1, {
        title: 'Ujian TKA Tanpa Mapel',
        event_id: eventId,
        mode: 'tka',
        duration_minutes: 60,
      }, { sub: 'admin-1' }, mansatasDb);

      assert.equal(res.success, false);
      assert.equal(res.status, 400);
      assert.match(res.error!, /subject_id.*valid.*tidak boleh kosong/i);
    });

    it('2.3 Generic/admin attempt to create TKA exam with unverified/synthetic subject is rejected', async () => {
      reset();
      const ev = await createTkaEvent(d1, mansatasDb, { code: 'TKA-GEN2', name: 'TKA Gen 2', academic_year_id: 'ta-2026' }, 'admin-1');
      const eventId = ev.id!;

      // 1. Synthetic subject
      const resSynthetic = await createExam(d1, {
        title: 'Ujian TKA Sintetis',
        event_id: eventId,
        mode: 'tka',
        subject_id: 'tka-fisika',
        duration_minutes: 60,
      }, { sub: 'admin-1' }, mansatasDb);

      assert.equal(resSynthetic.success, false);
      assert.equal(resSynthetic.status, 400);
      assert.match(resSynthetic.error!, /sintetis dilarang/i);

      // 2. Non-existent subject
      const resBogus = await createExam(d1, {
        title: 'Ujian TKA Bogus',
        event_id: eventId,
        mode: 'tka',
        subject_id: 'mp-nonexistent-999',
        duration_minutes: 60,
      }, { sub: 'admin-1' }, mansatasDb);

      assert.equal(resBogus.success, false);
      assert.equal(resBogus.status, 400);
      assert.match(resBogus.error!, /tidak ditemukan di database Mansatas/i);
    });

    it('2.4 Raw low-level SQL insert with NULL subject is rejected by DB trigger', () => {
      reset();
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, status)
        VALUES ('ev-trg', 'TKA-TRG', 'Trigger Event', 'tka', 'draft');
      `);

      assert.throws(() => {
        cbtWrapper.rawSqlite.exec(`
          INSERT INTO cbt_exams (id, title, event_id, mode, subject_id)
          VALUES ('ex-raw-null', 'Raw Null Exam', 'ev-trg', 'tka', NULL);
        `);
      }, /TKA exams must have a non-null verified subject_id/);

      assert.throws(() => {
        cbtWrapper.rawSqlite.exec(`
          INSERT INTO cbt_exams (id, title, event_id, mode, subject_id)
          VALUES ('ex-raw-empty', 'Raw Empty Exam', 'ev-trg', 'tka', '   ');
        `);
      }, /TKA exams must have a non-null verified subject_id/);
    });

    it('2.5 Generic update TKA subject_id before and after freeze follows documented rules', async () => {
      reset();
      const ev = await createTkaEvent(d1, mansatasDb, { code: 'TKA-UPD', name: 'TKA Update Rules', academic_year_id: 'ta-2026' }, 'admin-1');
      const eventId = ev.id!;

      const ex1 = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
      const examId = ex1.id!;

      // 1. Before freeze: update with synthetic subject -> rejected
      const updSyn = await updateExam(d1, examId, { subject_id: 'tka-kimia' }, mansatasDb);
      assert.equal(updSyn.success, false);
      assert.match(updSyn.error!, /sintetis dilarang/i);

      // 2. Before freeze: update with valid verified subject -> succeeds
      const updValid = await updateExam(d1, examId, { subject_id: 'mp-kim' }, mansatasDb);
      assert.ok(updValid.success);
      const row = await d1.prepare('SELECT subject_id FROM cbt_exams WHERE id = ?').bind(examId).first<any>();
      assert.equal(row.subject_id, 'mp-kim');

      // 3. Freeze event to ready
      cbtWrapper.rawSqlite.exec(`UPDATE cbt_events SET status = 'ready' WHERE id = '${eventId}'`);

      // 4. After freeze: update subject_id -> rejected (409)
      const updFrozen = await updateExam(d1, examId, { subject_id: 'mp-bio' }, mansatasDb);
      assert.equal(updFrozen.success, false);
      assert.equal(updFrozen.status, 409);
      assert.match(updFrozen.error!, /subject set beku/i);
    });

    it('2.6 Generic update TKA active_status is strictly rejected (authority hierarchy)', async () => {
      reset();
      const ev = await createTkaEvent(d1, mansatasDb, { code: 'TKA-ACT', name: 'TKA Active Guard', academic_year_id: 'ta-2026' }, 'admin-1');
      const ex = await createTkaExam(d1, mansatasDb, ev.id!, { subject_id: 'mp-fis' }, 'admin-1');

      const res = await updateExam(d1, ex.id!, { active_status: 'active' });
      assert.equal(res.success, false);
      assert.equal(res.status, 400);
      assert.match(res.error!, /Status ujian TKA dikelola secara kanonikal melalui lifecycle event/i);
    });

    it('2.7 ready+ create/delete/subject replacement are strictly rejected', async () => {
      reset();
      const ev = await createTkaEvent(d1, mansatasDb, { code: 'TKA-FRZ', name: 'TKA Freeze Matrix', academic_year_id: 'ta-2026' }, 'admin-1');
      const eventId = ev.id!;
      const ex = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
      const examId = ex.id!;

      // Freeze event
      cbtWrapper.rawSqlite.exec(`UPDATE cbt_events SET status = 'ready' WHERE id = '${eventId}'`);

      // 1. Create rejected
      await assert.rejects(
        async () => createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-kim' }, 'admin-1'),
        /EventFrozenError|Ready/
      );

      // 2. Generic createExam rejected
      const genCreate = await createExam(d1, {
        title: 'New Exam',
        event_id: eventId,
        mode: 'tka',
        subject_id: 'mp-kim',
        duration_minutes: 60,
      }, { sub: 'admin-1' }, mansatasDb);
      assert.equal(genCreate.success, false);
      assert.equal(genCreate.status, 409);

      // 3. Delete rejected
      const delRes = await deleteExam(d1, examId);
      assert.equal(delRes.success, false);
      assert.equal(delRes.status, 409);

      // 4. Subject replacement rejected
      const updRes = await updateExam(d1, examId, { subject_id: 'mp-bio' }, mansatasDb);
      assert.equal(updRes.success, false);
      assert.equal(updRes.status, 409);
    });

    it('2.8 Kegiatan multi-exam and Ulangan 1:1 invariants remain completely unchanged', async () => {
      reset();
      // 1. Kegiatan: can create multiple exams without subject
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, status)
        VALUES ('ev-keg', 'KEG-01', 'Kegiatan Event', 'kegiatan', 'draft');
      `);
      const k1 = await createExam(d1, { title: 'Kegiatan Exam 1', event_id: 'ev-keg', mode: 'kegiatan', duration_minutes: 60 }, { sub: 'admin-1' });
      const k2 = await createExam(d1, { title: 'Kegiatan Exam 2', event_id: 'ev-keg', mode: 'kegiatan', duration_minutes: 60 }, { sub: 'admin-1' });
      assert.ok(k1.success);
      assert.ok(k2.success);

      // 2. Ulangan: enforces 1:1 event-exam
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, status)
        VALUES ('ev-ul', 'UL-01', 'Ulangan Event', 'ulangan', 'draft');
      `);
      const u1 = await createExam(d1, { title: 'Ulangan Exam 1', event_id: 'ev-ul', mode: 'ulangan', duration_minutes: 45 }, { sub: 'teacher-1' });
      assert.ok(u1.success);
      const u2 = await createExam(d1, { title: 'Ulangan Exam 2', event_id: 'ev-ul', mode: 'ulangan', duration_minutes: 45 }, { sub: 'teacher-1' });
      assert.equal(u2.success, false);
      assert.equal(u2.status, 409);
    });
  });

  // ── ISSUE 3: Narrow tka.results.read Authority vs tka.access ────
  describe('Issue 3: Narrowed RBAC Authority Matrix', () => {
    let cbtWrapper: ReturnType<typeof createMockCbtDb>;
    let d1: any;
    let mansatasDb: any;
    let app: Hono<any>;
    let eventId: string;
    let examId: string;

    beforeEach(async () => {
      cbtWrapper = createMockCbtDb();
      d1 = cbtWrapper.d1;
      mansatasDb = createMockMansatasDb();

      app = new Hono();
      app.use('*', async (c, next) => {
        (c.env as any) = { DB: d1, MANSATAS_DB: mansatasDb, JWT_SECRET };
        await next();
      });
      app.route('/api/tka', tkaRoutes);

      const ev = await createTkaEvent(d1, mansatasDb, { code: 'TKA-RBAC3', name: 'TKA RBAC3', academic_year_id: 'ta-2026' }, 'admin-1');
      eventId = ev.id!;
      const ex = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
      examId = ex.id!;

      // Insert question, token, and session for full test surface
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_questions (id, exam_id, question_text) VALUES ('q-1', '${examId}', 'Berapakah 1+1?');
        INSERT INTO cbt_rooms (id, room_name) VALUES ('r-1', 'Ruang 1');
        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code) VALUES ('tok-1', '${examId}', 'r-1', 'TOK123');
        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status) VALUES ('sess-1', '${examId}', 'stu-1', 'mansatas', 'active');
      `);
    });

    async function makeToken(role: string, permissions: string[] = [], staffId: string = 'staff-1') {
      const token = await signJWT({
        sub: staffId,
        staff_id: staffId,
        role,
        permissions,
        user_type: 'cbt_user',
      }, JWT_SECRET);
      return { Authorization: `Bearer ${token}` };
    }

    it('3.1 User with only tka.results.read can access results/analytics but CANNOT access event config, participants, rooms, questions, tokens, or sessions', async () => {
      const headers = await makeToken('guru', ['tka.results.read']);

      // Allowed surfaces
      const resResults = await app.request(`/api/tka/exams/${examId}/results`, { headers });
      assert.equal(resResults.status, 200);

      const resExport = await app.request(`/api/tka/exams/${examId}/results-export`, { headers });
      assert.equal(resExport.status, 200);

      const resQAnalytics = await app.request(`/api/tka/exams/${examId}/question-analytics`, { headers });
      assert.equal(resQAnalytics.status, 200);

      const resAnalytics = await app.request(`/api/tka/exams/${examId}/analytics`, { headers });
      assert.equal(resAnalytics.status, 200);

      // Denied administrative & configuration read surfaces (403)
      const resEvent = await app.request(`/api/tka/events/${eventId}`, { headers });
      assert.equal(resEvent.status, 403);

      const resParts = await app.request(`/api/tka/events/${eventId}/participants`, { headers });
      assert.equal(resParts.status, 403);

      const resPreview = await app.request(`/api/tka/events/${eventId}/participants/preview`, { headers });
      assert.equal(resPreview.status, 403);

      const resRooms = await app.request(`/api/tka/events/${eventId}/rooms`, { headers });
      assert.equal(resRooms.status, 403);

      const resQuestions = await app.request(`/api/tka/exams/${examId}/questions`, { headers });
      assert.equal(resQuestions.status, 403);

      const resTokens = await app.request(`/api/tka/exams/${examId}/tokens`, { headers });
      assert.equal(resTokens.status, 403);

      const resSessions = await app.request(`/api/tka/exams/${examId}/sessions`, { headers });
      assert.equal(resSessions.status, 403);

      const resMonitoring = await app.request(`/api/tka/exams/${examId}/monitoring`, { headers });
      assert.equal(resMonitoring.status, 403);

      // Denied mutations (403)
      const resUnlock = await app.request(`/api/tka/exams/${examId}/sessions/sess-1/unlock`, { method: 'POST', headers });
      assert.equal(resUnlock.status, 403);
    });

    it('3.2 User with tka.access can access dashboard/config/results reads, but cannot perform mutations', async () => {
      const headers = await makeToken('guru', ['tka.access']);

      // Allowed reads
      const resEvent = await app.request(`/api/tka/events/${eventId}`, { headers });
      assert.equal(resEvent.status, 200);

      const resParts = await app.request(`/api/tka/events/${eventId}/participants`, { headers });
      assert.equal(resParts.status, 200);

      const resRooms = await app.request(`/api/tka/events/${eventId}/rooms`, { headers });
      assert.equal(resRooms.status, 200);

      const resQuestions = await app.request(`/api/tka/exams/${examId}/questions`, { headers });
      assert.equal(resQuestions.status, 200);

      const resTokens = await app.request(`/api/tka/exams/${examId}/tokens`, { headers });
      assert.equal(resTokens.status, 200);

      const resSessions = await app.request(`/api/tka/exams/${examId}/sessions`, { headers });
      assert.equal(resSessions.status, 200);

      const resResults = await app.request(`/api/tka/exams/${examId}/results`, { headers });
      assert.equal(resResults.status, 200);

      // Mutations denied (403)
      const resAssign = await app.request(`/api/tka/events/${eventId}/rooms/assign`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ student_id: 's-1', room_id: 'r-1' }),
      });
      assert.equal(resAssign.status, 403);
    });

    it('3.3 User with tka.event.manage can perform mutations', async () => {
      const headers = await makeToken('guru', ['tka.event.manage', 'tka.access']);

      const resAssign = await app.request(`/api/tka/events/${eventId}/rooms/assign`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ student_id: 's-1', room_id: 'r-1' }),
      });
      assert.equal(resAssign.status, 200);
    });

    it('3.4 Admin / platform.manage has full oversight across read, results, and mutation', async () => {
      const headers = await makeToken('admin');

      const resEvent = await app.request(`/api/tka/events/${eventId}`, { headers });
      assert.equal(resEvent.status, 200);

      const resResults = await app.request(`/api/tka/exams/${examId}/results`, { headers });
      assert.equal(resResults.status, 200);

      const resUnlock = await app.request(`/api/tka/exams/${examId}/sessions/sess-1/unlock`, { method: 'POST', headers });
      assert.equal(resUnlock.status, 200);
    });
  });

  // ── ISSUE 4: TKA Subject Registry Membership Invariant Verification ──
  describe('Issue 4: TKA Subject Registry Membership Invariant Verification', () => {
    let cbtWrapper: ReturnType<typeof createMockCbtDb>;
    let d1: any;
    let mansatasDb: any;
    let eventId: string;

    beforeEach(async () => {
      cbtWrapper = createMockCbtDb();
      d1 = cbtWrapper.d1;
      mansatasDb = createMockMansatasDb();

      const ev = await createTkaEvent(
        d1,
        mansatasDb,
        { code: 'TKA-REG-01', name: 'TKA Registry Event', academic_year_id: 'ta-2026' },
        'admin-1'
      );
      eventId = ev.id!;
    });

    it('4.1 Allowed canonical TKA Mansatas subject -> accepted', async () => {
      // 1. Via createTkaExam
      const resTka = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
      assert.equal(resTka.success, true);
      assert.ok(resTka.id);

      // 2. Via generic createExam
      const resGen = await createExam(
        d1,
        {
          title: 'TKA Kimia',
          event_id: eventId,
          mode: 'tka',
          subject_id: 'mp-kim',
          duration_minutes: 60,
        },
        { sub: 'admin-1' },
        mansatasDb
      );
      assert.equal(resGen.success, true);
      assert.ok(resGen.data?.id);
    });

    it('4.2 Nonexistent Mansatas subject -> rejected', async () => {
      // 1. Via createTkaExam
      const resTka = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-ghost-404' }, 'admin-1');
      assert.equal(resTka.success, false);
      assert.match(resTka.error!, /tidak ditemukan di database Mansatas|tidak valid atau tidak terdaftar/i);

      // 2. Via generic createExam
      const resGen = await createExam(
        d1,
        {
          title: 'TKA Nonexistent',
          event_id: eventId,
          mode: 'tka',
          subject_id: 'mp-ghost-404',
          duration_minutes: 60,
        },
        { sub: 'admin-1' },
        mansatasDb
      );
      assert.equal(resGen.success, false);
      assert.equal(resGen.status, 400);
      assert.match(resGen.error!, /tidak ditemukan di database Mansatas|tidak valid atau tidak terdaftar/i);
    });

    it('4.3 Synthetic tka-* ID -> rejected', async () => {
      // 1. Via createTkaExam
      const resTka = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'tka-fisika' }, 'admin-1');
      assert.equal(resTka.success, false);
      assert.match(resTka.error!, /sintetis dilarang/i);

      // 2. Via generic createExam
      const resGen = await createExam(
        d1,
        {
          title: 'TKA Sintetis',
          event_id: eventId,
          mode: 'tka',
          subject_id: 'tka-kimia',
          duration_minutes: 60,
        },
        { sub: 'admin-1' },
        mansatasDb
      );
      assert.equal(resGen.success, false);
      assert.equal(resGen.status, 400);
      assert.match(resGen.error!, /sintetis dilarang/i);
    });

    it('4.4 Real Mansatas mata_pelajaran.id but NOT registered in canonical TKA registry -> rejected', async () => {
      // mp-pjok and mp-sbk exist in Mansatas mata_pelajaran but are NOT canonical TKA subjects

      // 1. Via createTkaExam with mp-pjok
      const resPjok = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-pjok' }, 'admin-1');
      assert.equal(resPjok.success, false);
      assert.match(resPjok.error!, /bukan merupakan mata pelajaran resmi TKA yang terdaftar pada registry kanonikal/i);

      // 2. Via generic createExam with mp-sbk
      const resSbk = await createExam(
        d1,
        {
          title: 'TKA Seni Budaya',
          event_id: eventId,
          mode: 'tka',
          subject_id: 'mp-sbk',
          duration_minutes: 60,
        },
        { sub: 'admin-1' },
        mansatasDb
      );
      assert.equal(resSbk.success, false);
      assert.equal(resSbk.status, 400);
      assert.match(resSbk.error!, /bukan merupakan mata pelajaran resmi TKA yang terdaftar pada registry kanonikal/i);
    });

    it('4.5 Update mutable TKA exam to non-TKA Mansatas subject -> rejected', async () => {
      // Create a valid TKA exam
      const created = await createTkaExam(d1, mansatasDb, eventId, { subject_id: 'mp-fis' }, 'admin-1');
      assert.ok(created.success);
      const examId = created.id!;

      // Attempt to update subject_id to mp-pjok (exists in Mansatas, but not canonical TKA)
      const updPjok = await updateExam(d1, examId, { subject_id: 'mp-pjok' }, mansatasDb);
      assert.equal(updPjok.success, false);
      assert.equal(updPjok.status, 400);
      assert.match(updPjok.error!, /bukan merupakan mata pelajaran resmi TKA yang terdaftar pada registry kanonikal/i);

      // Attempt to update subject_id to mp-sbk (exists in Mansatas, but not canonical TKA)
      const updSbk = await updateExam(d1, examId, { subject_id: 'mp-sbk' }, mansatasDb);
      assert.equal(updSbk.success, false);
      assert.equal(updSbk.status, 400);
      assert.match(updSbk.error!, /bukan merupakan mata pelajaran resmi TKA yang terdaftar pada registry kanonikal/i);

      // Verify original subject remains unchanged
      const row = await d1.prepare('SELECT subject_id FROM cbt_exams WHERE id = ?').bind(examId).first<any>();
      assert.equal(row.subject_id, 'mp-fis');

      // Valid canonical update (e.g. mp-bio) must succeed
      const updBio = await updateExam(d1, examId, { subject_id: 'mp-bio' }, mansatasDb);
      assert.equal(updBio.success, true);
      const updatedRow = await d1.prepare('SELECT subject_id FROM cbt_exams WHERE id = ?').bind(examId).first<any>();
      assert.equal(updatedRow.subject_id, 'mp-bio');
    });

    it('4.6 Kegiatan/Ulangan subject behavior -> unchanged', async () => {
      // 1. Kegiatan exam can use non-TKA Mansatas subject (or no subject) without rejection
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, status)
        VALUES ('ev-keg-subj', 'KEG-SUBJ', 'Kegiatan Subj', 'kegiatan', 'draft');
      `);
      const kegExam = await createExam(
        d1,
        {
          title: 'Ujian Penjas Kegiatan',
          event_id: 'ev-keg-subj',
          mode: 'kegiatan',
          subject_id: 'mp-pjok',
          duration_minutes: 60,
        },
        { sub: 'admin-1' },
        mansatasDb
      );
      assert.equal(kegExam.success, true);
      assert.ok(kegExam.data?.id);

      // Update Kegiatan exam to another non-TKA subject succeeds
      const updKeg = await updateExam(d1, kegExam.data!.id, { subject_id: 'mp-sbk' }, mansatasDb);
      assert.equal(updKeg.success, true);

      // 2. Ulangan exam can use non-TKA Mansatas subject without rejection
      cbtWrapper.rawSqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, status)
        VALUES ('ev-ul-subj', 'UL-SUBJ', 'Ulangan Subj', 'ulangan', 'draft');
      `);
      const ulExam = await createExam(
        d1,
        {
          title: 'Ulangan Seni Budaya',
          event_id: 'ev-ul-subj',
          mode: 'ulangan',
          subject_id: 'mp-sbk',
          duration_minutes: 45,
        },
        { sub: 'teacher-1' },
        mansatasDb
      );
      assert.equal(ulExam.success, true);
      assert.ok(ulExam.data?.id);

      // Update Ulangan exam to another non-TKA subject succeeds
      const updUl = await updateExam(d1, ulExam.data!.id, { subject_id: 'mp-pjok' }, mansatasDb);
      assert.equal(updUl.success, true);
    });
  });
});
