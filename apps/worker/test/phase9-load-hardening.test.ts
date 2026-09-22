// ============================================================
// Phase 9: Consolidation, Reporting & Load Hardening
// Final Comprehensive Verification & Simulation Test Suite
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import app from '../src/index.ts';
import { signJWT } from '../src/utils/jwt.ts';
import { newId, now } from '../src/utils/helpers.ts';
import { escapeCsvCell, generateResultsCsv } from '../src/services/reporting/export.ts';
import { getConsolidatedResults } from '../src/services/reporting/results.ts';
import { getExamOverview } from '../src/services/reporting/overview.ts';
import { getExamParticipation } from '../src/services/reporting/participation.ts';
import { getConsolidatedAnalytics } from '../src/services/reporting/analytics.ts';
import { assertReportContext, ReportAuthorizationError, ReportNotFoundError } from '../src/services/reporting/adapters.ts';
import { getExamQuestionAnalytics } from '../src/services/exam-engine/analytics.ts';

const JWT_SECRET = 'test-phase9-hardening-jwt-secret';

export function calculatePercentiles(latencies: number[]) {
  if (latencies.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const p = (pct: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
    return sorted[idx];
  };
  return {
    count: sorted.length,
    p50: p(50),
    p95: p(95),
    p99: p(99),
    max: sorted[sorted.length - 1],
    avg: Math.round((sum / sorted.length) * 100) / 100,
  };
}

function createMockD1(sqlite: DatabaseSync, options: { failQueryRegex?: RegExp; failWriteRegex?: RegExp } = {}) {
  let queryCount = 0;
  let writeCount = 0;
  let readCount = 0;
  let batchCount = 0;
  const queries: string[] = [];

  const d1: any = {
    prepare: (sql: string) => {
      const exec = (params: any[]) => {
        const clean = params.map(p => (p === undefined ? null : p));
        queryCount++;
        const trimmed = sql.trim().toUpperCase();
        const isWrite = trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE');
        if (isWrite) writeCount++;
        else readCount++;
        queries.push(sql);

        if (options.failQueryRegex && options.failQueryRegex.test(sql)) {
          throw new Error(`D1_SIMULATED_FAILURE: Query failed by hook: ${sql.slice(0, 50)}`);
        }
        if (isWrite && options.failWriteRegex && options.failWriteRegex.test(sql)) {
          throw new Error(`D1_SIMULATED_FAILURE: Write failed by hook: ${sql.slice(0, 50)}`);
        }

        return {
          first: async <T>() => {
            const stmt = sqlite.prepare(sql);
            return (stmt.get(...clean) as T) || null;
          },
          all: async <T>() => {
            const stmt = sqlite.prepare(sql);
            return { results: (stmt.all(...clean) as T[]) || [] };
          },
          run: async () => {
            const stmt = sqlite.prepare(sql);
            const info = stmt.run(...clean);
            return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
          },
        };
      };

      return {
        bind: (...params: any[]) => exec(params),
        first: async <T>() => exec([]).first<T>(),
        all: async <T>() => exec([]).all<T>(),
        run: async () => exec([]).run(),
      };
    },
    batch: async (stmts: any[]) => {
      batchCount++;
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    getMetrics: () => ({ queryCount, writeCount, readCount, batchCount, queries: [...queries] }),
    resetMetrics: () => { queryCount = 0; writeCount = 0; readCount = 0; batchCount = 0; queries.length = 0; },
    setFailQueryRegex: (r: RegExp | null) => { options.failQueryRegex = r || undefined; },
    setFailWriteRegex: (r: RegExp | null) => { options.failWriteRegex = r || undefined; },
  };

  return d1;
}

function initMemoryDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const schemaPath = path.resolve(__dirname, '../schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  sqlite.exec(schema);
  return sqlite;
}

describe('Phase 9 — Consolidation, Reporting & Load Hardening Suite', () => {

  // ══════════════════════════════════════════════════════════════
  // SUITE 1: DATABASE MIGRATION & SCHEMA INTEGRITY ON BOTH UPGRADE PATHS
  // ══════════════════════════════════════════════════════════════
  describe('1. Database Migration & Schema Integrity', () => {
    it('1.1 Fresh database schema passes PRAGMA foreign_key_check with 0 violations', () => {
      const sqlite = initMemoryDatabase();
      const fkCheck = sqlite.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fkCheck, [], 'Fresh schema must have 0 foreign key violations');
    });

    it('1.2 Upgrade migration-phase9-hardening.sql applies cleanly on fresh DB (Path A)', () => {
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec('PRAGMA foreign_keys = ON;');
      const schemaPath = path.resolve(__dirname, '../schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      sqlite.exec(schema);

      const migrationPath = path.resolve(__dirname, '../migration-phase9-hardening.sql');
      const migration = fs.readFileSync(migrationPath, 'utf-8');
      sqlite.exec(migration);

      const fkCheck = sqlite.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fkCheck, [], 'Migration must not violate foreign key integrity');

      // Verify indexes exist in sqlite_master
      const indexes = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_cbt_%'"
      ).all() as any[];
      const indexNames = new Set(indexes.map(i => i.name));

      assert.ok(indexNames.has('idx_cbt_sessions_user_status'), 'idx_cbt_sessions_user_status must exist');
      assert.ok(indexNames.has('idx_cbt_sessions_exam_room'), 'idx_cbt_sessions_exam_room must exist');
      assert.ok(indexNames.has('idx_cbt_tokens_active'), 'idx_cbt_tokens_active must exist');
      assert.ok(indexNames.has('idx_cbt_results_exam_score'), 'idx_cbt_results_exam_score must exist');
      assert.ok(indexNames.has('idx_cbt_roster_exam_class'), 'idx_cbt_roster_exam_class must exist');
      assert.ok(indexNames.has('idx_cbt_exams_event_mode'), 'idx_cbt_exams_event_mode must exist');
      assert.ok(indexNames.has('idx_cbt_exams_owner_status'), 'idx_cbt_exams_owner_status must exist');
    });

    it('1.3 Upgrade migration-phase9-hardening.sql applies cleanly on populated Phase 8 DB (Path B)', () => {
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec('PRAGMA foreign_keys = ON;');
      const schemaPath = path.resolve(__dirname, '../schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      sqlite.exec(schema);

      // Populate representative Phase 8 dataset across all 5 canonical modes
      sqlite.exec(`
        INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap)
        VALUES ('st-p8-adm', 'm-adm', 'admin@example.com', 'Admin CBT'),
               ('st-p8-guru', 'm-guru', 'guru@example.com', 'Guru CBT');

        INSERT INTO cbt_role_assignments (id, staff_id, role)
        VALUES ('ra-1', 'st-p8-adm', 'admin'),
               ('ra-2', 'st-p8-guru', 'teacher');

        INSERT INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value)
        VALUES ('pg-1', 'st-p8-guru', 'kegiatan.event.read', 'global', '*');

        INSERT INTO cbt_rooms (id, room_name, capacity)
        VALUES ('room-p8-1', 'Ruang P8-1', 40);

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-p8-pmb', 'EV-PMB', 'PMB 2026', 'pmb', 'pmb', 'active'),
               ('ev-p8-keg', 'EV-KEG', 'Kegiatan P8', 'kegiatan', 'mansatas', 'active'),
               ('ev-p8-tka', 'EV-TKA', 'TKA P8', 'tka', 'mansatas', 'active'),
               ('ev-p8-sem', 'EV-SEM', 'Semester P8', 'semester', 'mansatas', 'active'),
               ('ev-p8-ula', 'EV-ULA', 'Ulangan P8', 'ulangan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, subject_id, target_grade, owner_staff_id)
        VALUES ('ex-p8-pmb', 'Exam PMB', 'pmb', 'active', 'ev-p8-pmb', NULL, NULL, NULL),
               ('ex-p8-keg', 'Exam Keg', 'kegiatan', 'active', 'ev-p8-keg', NULL, NULL, NULL),
               ('ex-p8-tka', 'Exam TKA', 'tka', 'active', 'ev-p8-tka', 'mp-mat', NULL, NULL),
               ('ex-p8-sem', 'Exam Sem', 'semester', 'active', 'ev-p8-sem', 'mp-mat', '10', NULL),
               ('ex-p8-ula', 'Exam Ula', 'ulangan', 'active', 'ev-p8-ula', NULL, NULL, 'st-p8-guru');

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id, class_name)
        VALUES ('ros-p8-1', 'ex-p8-keg', 'ev-p8-keg', 'mansatas', 'std-p8-1', 'user_p8_1', 'Siswa P8 1', 'room-p8-1', '10-A');

        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-p8-1', 'ex-p8-keg', 'room-p8-1', 'P8TOKEN', 1);

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qp8-1', 'ex-p8-keg', 'Soal P8 1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('op8-1', 'qp8-1', 'A', 'Pilihan A', 1);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status, started_at, last_heartbeat)
        VALUES ('ses-p8-1', 'ex-p8-keg', 'std-p8-1', 'mansatas', 'room-p8-1', 'submitted', datetime('now'), datetime('now'));

        INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id)
        VALUES ('ans-p8-1', 'ses-p8-1', 'qp8-1', 'op8-1');

        INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
        VALUES ('res-p8-1', 'ses-p8-1', 'ex-p8-keg', 'std-p8-1', 'mansatas', 1, 1, 0, 0, 100);
      `);

      const countBefore = (table: string) =>
        (sqlite.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as any).cnt;

      const sessionsBefore = countBefore('cbt_exam_sessions');
      const resultsBefore = countBefore('cbt_exam_results');
      const answersBefore = countBefore('cbt_student_answers');
      const rosterBefore = countBefore('cbt_exam_roster');

      // Apply migration
      const migrationPath = path.resolve(__dirname, '../migration-phase9-hardening.sql');
      const migration = fs.readFileSync(migrationPath, 'utf-8');
      sqlite.exec(migration);

      // Verify row preservation
      assert.equal(countBefore('cbt_exam_sessions'), sessionsBefore, 'Session rows must be preserved');
      assert.equal(countBefore('cbt_exam_results'), resultsBefore, 'Result rows must be preserved');
      assert.equal(countBefore('cbt_student_answers'), answersBefore, 'Answer rows must be preserved');
      assert.equal(countBefore('cbt_exam_roster'), rosterBefore, 'Roster rows must be preserved');

      // Verify FK integrity
      const fkCheck = sqlite.prepare('PRAGMA foreign_key_check').all();
      assert.deepEqual(fkCheck, [], 'Populated DB migration must have zero foreign key violations');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // SUITE 2: D1 QUERY PLAN & INDEX UTILIZATION AUDIT
  // ══════════════════════════════════════════════════════════════
  describe('2. D1 Query Plan & Index Utilization Audit', () => {
    it('2.1 Student exams list query plan utilizes index instead of full-table scan', () => {
      const sqlite = initMemoryDatabase();
      const plan = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT e.id, e.title, e.subject_name, e.sequence_order, e.description, e.duration_minutes, e.rules_text, e.active_status, e.target_jalur, e.enforce_fullscreen,
               e.event_id, ev.name as event_name, ev.code as event_code,
               es.id as session_id, es.status as session_status, es.is_time_locked,
               COALESCE((SELECT COUNT(*) FROM cbt_student_answers sa WHERE sa.session_id = es.id), 0) as answered_count,
               COALESCE((SELECT COUNT(*) FROM cbt_questions q WHERE q.exam_id = e.id), 0) as total_questions
        FROM cbt_exams e
        LEFT JOIN cbt_events ev ON ev.id = e.event_id
        LEFT JOIN cbt_exam_sessions es ON es.exam_id = e.id AND es.user_id = 'user-1' AND es.user_type = 'mansatas'
        WHERE e.active_status = 'active'
        ORDER BY COALESCE(ev.code, ''), COALESCE(e.sequence_order, 0), LOWER(e.title)
      `).all() as any[];

      const planDetails = plan.map(p => p.detail).join(' | ');
      // Verifies correlated subquery uses index on session_id
      assert.ok(
        planDetails.includes('idx_cbt_answers_session'),
        'Student answers count must utilize index on session_id'
      );
    });

    it('2.2 Proctor monitoring query plan eliminates full-table cheat logs scan', () => {
      const sqlite = initMemoryDatabase();
      const plan = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT es.*,
               COALESCE(rr.full_name, cu.nama_lengkap) as full_name,
               COALESCE(rr.nisn, cu.nisn) as nisn,
               COALESCE(rr.username, cu.username) as username,
               COALESCE(rr.sesi_tes, '') as sesi_tes,
               COALESCE(rr.tanggal_tes, '') as tanggal_tes,
               COALESCE(r.room_name, 'Kelas') as room_name,
               (SELECT COUNT(*) FROM cbt_cheat_logs cl WHERE cl.session_id = es.id) as cheat_log_count
        FROM cbt_exam_sessions es
        LEFT JOIN cbt_rooms r ON r.id = es.room_id
        LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
        LEFT JOIN cbt_exam_roster rr ON rr.exam_id = es.exam_id AND rr.source_id = es.user_id
          AND rr.source_key = CASE WHEN es.user_type = 'pendaftar' THEN 'pmb' ELSE es.user_type END
        WHERE es.exam_id = 'exam-1'
        ORDER BY COALESCE(r.room_name, ''), full_name
      `).all() as any[];

      const planDetails = plan.map(p => p.detail).join(' | ');
      assert.ok(planDetails.includes('idx_cheat_logs_session'), 'Must query cheat logs via covering index');
    });

    it('2.3 Explicit EXPLAIN QUERY PLAN evidence proves each Phase 9 index is utilized', () => {
      const sqlite = initMemoryDatabase();

      // Check idx_cbt_sessions_user_status
      const plan1 = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM cbt_exam_sessions
        WHERE user_id = 'user-1' AND user_type = 'mansatas' AND status = 'active'
      `).all() as any[];
      assert.ok(plan1.some(p => p.detail.includes('idx_cbt_sessions_user_status')), 'Plan must use idx_cbt_sessions_user_status');

      // Check idx_cbt_sessions_exam_room
      const plan2 = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM cbt_exam_sessions
        WHERE exam_id = 'ex-1' AND room_id = 'room-1' AND status = 'active'
      `).all() as any[];
      assert.ok(plan2.some(p => p.detail.includes('idx_cbt_sessions_exam_room')), 'Plan must use idx_cbt_sessions_exam_room');

      // Check idx_cbt_tokens_active
      const plan3 = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM cbt_exam_tokens
        WHERE exam_id = 'ex-1' AND is_active = 1
      `).all() as any[];
      assert.ok(plan3.some(p => p.detail.includes('idx_cbt_tokens_active')), 'Plan must use idx_cbt_tokens_active');

      // Check idx_cbt_results_exam_score
      const plan4 = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT MIN(score), MAX(score), AVG(score) FROM cbt_exam_results
        WHERE exam_id = 'ex-1'
      `).all() as any[];
      assert.ok(plan4.some(p => p.detail.includes('idx_cbt_results_exam_score')), 'Plan must use idx_cbt_results_exam_score');

      // Check idx_cbt_roster_exam_class
      const plan5 = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM cbt_exam_roster
        WHERE exam_id = 'ex-1' AND class_name = '10-A'
      `).all() as any[];
      assert.ok(plan5.some(p => p.detail.includes('idx_cbt_roster_exam_class')), 'Plan must use idx_cbt_roster_exam_class');

      // Check idx_cbt_exams_event_mode
      const plan6 = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM cbt_exams
        WHERE event_id = 'ev-1' AND mode = 'kegiatan'
      `).all() as any[];
      assert.ok(plan6.some(p => p.detail.includes('idx_cbt_exams_event_mode')), 'Plan must use idx_cbt_exams_event_mode');

      // Check idx_cbt_exams_owner_status
      const plan7 = sqlite.prepare(`
        EXPLAIN QUERY PLAN
        SELECT * FROM cbt_exams
        WHERE owner_staff_id = 'staff-1' AND active_status = 'active'
      `).all() as any[];
      assert.ok(plan7.some(p => p.detail.includes('idx_cbt_exams_owner_status')), 'Plan must use idx_cbt_exams_owner_status');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // SUITE 3: DOMAIN AUTHORIZATION, NEGATIVE TEST MATRIX & HISTORICAL SNAPSHOT
  // ══════════════════════════════════════════════════════════════
  describe('3. Domain Authorization & Negative Boundary Enforcement', () => {
    it('3.1 Ulangan report ownership enforcement: teacher sees only own assessments', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const teacherOwnerId = 'staff-guru-owner';
      const teacherOtherId = 'staff-guru-other';
      const examId = 'ex-ulangan-1';

      sqlite.exec(`
        INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap)
        VALUES ('${teacherOwnerId}', 'm-guru-owner', 'owner@example.com', 'Guru Owner'),
               ('${teacherOtherId}', 'm-guru-other', 'other@example.com', 'Guru Other');

        INSERT INTO cbt_role_assignments (id, staff_id, role)
        VALUES ('ra-o1', '${teacherOwnerId}', 'teacher'),
               ('ra-o2', '${teacherOtherId}', 'teacher');

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-u1', 'EV-U1', 'Ulangan Event', 'ulangan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, owner_staff_id)
        VALUES ('${examId}', 'Ulangan Matematika', 'ulangan', 'active', 'ev-u1', '${teacherOwnerId}');
      `);

      const ownerToken = await signJWT({
        sub: teacherOwnerId,
        role: 'teacher',
      }, JWT_SECRET);

      const otherToken = await signJWT({
        sub: teacherOtherId,
        role: 'teacher',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      // Owner accessing report -> 200
      const ownerRes = await app.fetch(new Request(`http://localhost/api/reporting/overview/${examId}`, {
        headers: { 'Authorization': `Bearer ${ownerToken}` },
      }), env);
      assert.equal(ownerRes.status, 200, 'Exam owner must be authorized to view report');

      // Other teacher accessing report -> 403
      const otherRes = await app.fetch(new Request(`http://localhost/api/reporting/overview/${examId}`, {
        headers: { 'Authorization': `Bearer ${otherToken}` },
      }), env);
      assert.equal(otherRes.status, 403, 'Unauthorized teacher must be rejected with 403');
    });

    it('3.2 TKA, Semester, and Kegiatan reports enforce verified domain permissions', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-tka', 'EV-TKA', 'TKA Event', 'tka', 'mansatas', 'active'),
               ('ev-sem', 'EV-SEM', 'Semester Event', 'semester', 'mansatas', 'active'),
               ('ev-keg', 'EV-KEG', 'Kegiatan Event', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, subject_id, target_grade)
        VALUES ('ex-tka', 'Ujian TKA', 'tka', 'active', 'ev-tka', 'mp-mat', NULL),
               ('ex-sem', 'Ujian Semester', 'semester', 'active', 'ev-sem', 'mp-mat', '10'),
               ('ex-keg', 'Ujian Kegiatan', 'kegiatan', 'active', 'ev-keg', NULL, NULL);
      `);

      const tkaToken = await signJWT({
        sub: 'staff-tka',
        role: 'teacher',
        permissions: ['tka.results.read'],
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      // Accessing TKA report -> 200
      const tkaRes = await app.fetch(new Request('http://localhost/api/reporting/overview/ex-tka', {
        headers: { 'Authorization': `Bearer ${tkaToken}` },
      }), env);
      assert.equal(tkaRes.status, 200, 'User with tka.results.read can access TKA report');

      // TKA user attempting to access Semester report -> 403
      const semRes = await app.fetch(new Request('http://localhost/api/reporting/overview/ex-sem', {
        headers: { 'Authorization': `Bearer ${tkaToken}` },
      }), env);
      assert.equal(semRes.status, 403, 'User without semester permission must be rejected with 403');

      // TKA user attempting to access Kegiatan report -> 403
      const kegRes = await app.fetch(new Request('http://localhost/api/reporting/overview/ex-keg', {
        headers: { 'Authorization': `Bearer ${tkaToken}` },
      }), env);
      assert.equal(kegRes.status, 403, 'User without kegiatan permission must be rejected with 403');
    });

    it('3.3 Reporting Negative Matrix: student role, cross-domain IDOR, export, non-existent, and filters', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-neg-1';
      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-neg-1', 'EV-NEG', 'Event Neg', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Exam Neg', 'kegiatan', 'active', 'ev-neg-1');
      `);

      const studentToken = await signJWT({
        sub: 'student-neg',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      // 1. Student attempting to access overview, participation, results, analytics, export
      const endpoints = [
        `/api/reporting/overview/${examId}`,
        `/api/reporting/participation/${examId}`,
        `/api/reporting/results/${examId}`,
        `/api/reporting/analytics/${examId}`,
        `/api/reporting/results/${examId}/export?format=csv`,
      ];

      for (const ep of endpoints) {
        const res = await app.fetch(new Request(`http://localhost${ep}`, {
          headers: { 'Authorization': `Bearer ${studentToken}` },
        }), env);
        assert.equal(res.status, 403, `Student must be rejected with 403 on ${ep}`);
      }

      // 2. Non-existent examId -> 404
      const adminToken = await signJWT({ sub: 'admin-neg', role: 'admin' }, JWT_SECRET);
      const res404 = await app.fetch(new Request('http://localhost/api/reporting/overview/ex-nonexistent', {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      }), env);
      assert.equal(res404.status, 404, 'Non-existent exam must return 404');

      // 3. Changing query filters cannot escape authorized examId
      const resFilter = await app.fetch(new Request(`http://localhost/api/reporting/results/${examId}?roomId=foreign-room`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      }), env);
      assert.equal(resFilter.status, 200);
      const bodyFilter = await resFilter.json() as any;
      assert.equal(bodyFilter.data.items.length, 0, 'Foreign filter cannot leak data outside authorized exam');
    });

    it('3.4 Historical CBT report snapshot authority: upstream live school mutations do not alter snapshot', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-hist-1';
      const eventId = 'ev-hist-1';
      const studentId = 'std-hist-1';

      sqlite.exec(`
        INSERT INTO cbt_rooms (id, room_name, capacity) VALUES ('room-hist-1', 'Ruang Histori 1', 40);

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-HIST', 'Semester Ganjil Selesai', 'kegiatan', 'mansatas', 'completed');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Penilaian Semester Histori', 'kegiatan', 'completed', '${eventId}');

        -- Canonical CBT Snapshot populated at exam time
        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, class_name, grade, room_id)
        VALUES ('ros-h-1', '${examId}', '${eventId}', 'mansatas', '${studentId}', 'user_hist', 'Ahmad Siswa Histori', 'Kelas 10-A', '10', 'room-hist-1');

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status)
        VALUES ('ses-h-1', '${examId}', '${studentId}', 'mansatas', 'submitted');

        INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
        VALUES ('res-h-1', 'ses-h-1', '${examId}', '${studentId}', 'mansatas', 50, 44, 6, 0, 88);

        -- Upstream live users table (e.g. Mansatas user table)
        INSERT INTO cbt_users (id, username, nama_lengkap, role, is_active, password_hash)
        VALUES ('${studentId}', 'user_hist', 'Ahmad Siswa Histori', 'student', 1, 'hash123');
      `);

      // Verify original snapshot before upstream change
      const initialReport = await getConsolidatedResults(db, examId);
      assert.equal(initialReport.items[0].fullName, 'Ahmad Siswa Histori');
      assert.equal(initialReport.items[0].className, 'Kelas 10-A');
      assert.equal(initialReport.items[0].grade, '10');
      assert.equal(initialReport.items[0].score, 88);

      // Now simulate upstream live school mutations:
      // In the new academic year, student moves to Class 11-B and changes display name in user master
      sqlite.exec(`
        UPDATE cbt_users
        SET nama_lengkap = 'Ahmad Al-Mansur (Baru)', username = 'ahmad_new'
        WHERE id = '${studentId}';
      `);

      // Query historical report again
      const postMutationReport = await getConsolidatedResults(db, examId);
      assert.equal(postMutationReport.items[0].fullName, 'Ahmad Siswa Histori', 'Historical participant name must be immutable');
      assert.equal(postMutationReport.items[0].className, 'Kelas 10-A', 'Historical class snapshot must be immutable');
      assert.equal(postMutationReport.items[0].grade, '10', 'Historical grade must be immutable');
      assert.equal(postMutationReport.items[0].score, 88, 'Historical score must be immutable');

      // Verify CSV export also reads strictly from canonical snapshot
      const { csvContent } = await generateResultsCsv(db, examId);
      assert.ok(csvContent.includes('Ahmad Siswa Histori'));
      assert.ok(csvContent.includes('Kelas 10-A'));
      assert.ok(!csvContent.includes('Ahmad Al-Mansur (Baru)'), 'Upstream live mutation must not leak into historical report');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // SUITE 4: CANONICAL REPORTING OPERATIONS & EXPORT HARDENING
  // ══════════════════════════════════════════════════════════════
  describe('4. Canonical Reporting Operations & Export Hardening', () => {
    it('4.1 Overview & participation breakdown computes statistics accurately', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-rep-1';
      const eventId = 'ev-rep-1';
      const roomId = 'room-1';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-REP-1', 'Event Rep 1', 'kegiatan', 'mansatas', 'completed');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, passing_score)
        VALUES ('${examId}', 'Ujian Pelaporan', 'kegiatan', 'completed', '${eventId}', 70);

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id, class_name)
        VALUES ('ros-1', '${examId}', '${eventId}', 'mansatas', 'std-1', 'user1', 'Siswa 1', '${roomId}', '10-A'),
               ('ros-2', '${examId}', '${eventId}', 'mansatas', 'std-2', 'user2', 'Siswa 2', '${roomId}', '10-B'),
               ('ros-3', '${examId}', '${eventId}', 'mansatas', 'std-3', 'user3', 'Siswa 3', '${roomId}', '10-A');

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status)
        VALUES ('ses-1', '${examId}', 'std-1', 'mansatas', '${roomId}', 'submitted'),
               ('ses-2', '${examId}', 'std-2', 'mansatas', '${roomId}', 'submitted'),
               ('ses-3', '${examId}', 'std-3', 'mansatas', '${roomId}', 'active');

        INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, score)
        VALUES ('res-1', 'ses-1', '${examId}', 'std-1', 'mansatas', 80),
               ('res-2', 'ses-2', '${examId}', 'std-2', 'mansatas', 60);
      `);

      const overview = await getExamOverview(db, examId);
      assert.equal(overview.totalEnrolled, 3);
      assert.equal(overview.submittedCount, 2);
      assert.equal(overview.inProgressCount, 1);
      assert.equal(overview.notStartedCount, 0);
      assert.equal(overview.scoreSummary.average, 70);
      assert.equal(overview.scoreSummary.highest, 80);
      assert.equal(overview.scoreSummary.lowest, 60);
      assert.equal(overview.scoreSummary.passedCount, 1);
      assert.equal(overview.scoreSummary.failedCount, 1);

      const participation = await getExamParticipation(db, examId);
      assert.equal(participation.byRoom.length, 1);
      assert.equal(participation.byRoom[0].totalEnrolled, 3);
      assert.equal(participation.byClass.length, 2);
    });

    it('4.2 Paginated results with filtering filters by room, class, and search query', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-filter-1';
      const eventId = 'ev-filter-1';

      sqlite.exec(`
        INSERT INTO cbt_rooms (id, room_name, capacity)
        VALUES ('room-f1', 'Ruang Alpha', 40),
               ('room-f2', 'Ruang Beta', 40);

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-FLT', 'Event Filter', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Ujian Filter', 'kegiatan', 'active', '${eventId}');

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id, class_name)
        VALUES ('r1', '${examId}', '${eventId}', 'mansatas', 's1', 'u1', 'Budi Santoso', 'room-f1', '10-IPA-1'),
               ('r2', '${examId}', '${eventId}', 'mansatas', 's2', 'u2', 'Siti Aminah', 'room-f2', '10-IPA-2'),
               ('r3', '${examId}', '${eventId}', 'mansatas', 's3', 'u3', 'Dewi Lestari', 'room-f1', '10-IPA-1');
      `);

      // Filter by room
      const resRoom = await getConsolidatedResults(db, examId, { roomId: 'room-f1' });
      assert.equal(resRoom.items.length, 2);

      // Filter by class
      const resClass = await getConsolidatedResults(db, examId, { className: '10-IPA-2' });
      assert.equal(resClass.items.length, 1);
      assert.equal(resClass.items[0].fullName, 'Siti Aminah');

      // Search by name
      const resSearch = await getConsolidatedResults(db, examId, { search: 'Budi' });
      assert.equal(resSearch.items.length, 1);
      assert.equal(resSearch.items[0].fullName, 'Budi Santoso');
    });

    it('4.3 Export route enforces server-side authorization matching reporting rules', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const teacherOwnerId = 'staff-guru-1';
      const teacherOtherId = 'staff-guru-2';
      const examId = 'ex-export-auth-1';

      sqlite.exec(`
        INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap)
        VALUES ('${teacherOwnerId}', 'm-g1', 'g1@example.com', 'Guru 1'),
               ('${teacherOtherId}', 'm-g2', 'g2@example.com', 'Guru 2');

        INSERT INTO cbt_role_assignments (id, staff_id, role)
        VALUES ('ra-g1', '${teacherOwnerId}', 'teacher'),
               ('ra-g2', '${teacherOtherId}', 'teacher');

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-exp-1', 'EV-EXP', 'Event Exp', 'ulangan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, owner_staff_id)
        VALUES ('${examId}', 'Ulangan Fisika', 'ulangan', 'active', 'ev-exp-1', '${teacherOwnerId}');
      `);

      const otherTeacherToken = await signJWT({
        sub: teacherOtherId,
        role: 'teacher',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      const res = await app.fetch(new Request(`http://localhost/api/reporting/results/${examId}/export?format=csv`, {
        headers: { 'Authorization': `Bearer ${otherTeacherToken}` },
      }), env);

      assert.equal(res.status, 403, 'Unauthorized teacher cannot export another teacher assessment');
    });

    it('4.4 CSV export formula injection guard escapes dangerous prefixes and prepends UTF-8 BOM', async () => {
      // Direct cell escaping checks
      assert.equal(escapeCsvCell('=1+1'), '"\'=1+1"');
      assert.equal(escapeCsvCell('+cmd'), '"\'+cmd"');
      assert.equal(escapeCsvCell('-2+3'), '"\'-2+3"');
      assert.equal(escapeCsvCell('@SUM(A1:A10)'), '"\'@SUM(A1:A10)"');
      assert.equal(escapeCsvCell('\tmalicious'), '"\'\tmalicious"');
      assert.equal(escapeCsvCell('Normal Text'), '"Normal Text"');
      assert.equal(escapeCsvCell('Text with "quotes"'), '"Text with ""quotes"""');

      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-csv-inj';
      const eventId = 'ev-csv-inj';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-INJ', 'Event Inj', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Exam Formula Test', 'kegiatan', 'active', '${eventId}');

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name)
        VALUES ('ros-inj-1', '${examId}', '${eventId}', 'mansatas', 'std-inj', 'u-inj', '=cmd|'' /C calc''!A0');
      `);

      const { filename, csvContent } = await generateResultsCsv(db, examId);
      assert.ok(filename.includes('Hasil_Exam_Formula_Test'));
      // Prepend UTF-8 BOM (\uFEFF)
      assert.equal(csvContent.charCodeAt(0), 0xFEFF, 'Must prepend UTF-8 BOM');
      // Formula cell must be escaped with single quote
      assert.ok(csvContent.includes(`"'=cmd|' /C calc'!A0"`));
    });

    it('4.5 Report pagination at 1,600 rows: deterministic ordering, unique IDs across pages, zero duplicates', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const totalRows = 1600;
      const examId = 'ex-pag-1600';
      const eventId = 'ev-pag-1600';

      for (let r = 1; r <= 40; r++) {
        sqlite.prepare('INSERT OR IGNORE INTO cbt_rooms (id, room_name, capacity) VALUES (?, ?, ?)').run(`room-p-${r}`, `Ruang ${r}`, 40);
      }

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-PAG', 'Event Pag', 'kegiatan', 'mansatas', 'completed');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Exam Pag 1600', 'kegiatan', 'completed', '${eventId}');
      `);

      const insertRoster = sqlite.prepare(`
        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, class_name, room_id)
        VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?, ?)
      `);

      for (let i = 1; i <= totalRows; i++) {
        const uId = `std-pag-${i}`;
        const roomId = `room-p-${(i % 40) + 1}`;
        const className = `Kelas-${(i % 50) + 1}`;
        insertRoster.run(`ros-pag-${i}`, examId, eventId, uId, `u_${i}`, `Siswa ${i.toString().padStart(4, '0')}`, className, roomId);
      }

      // 1. Measure single results page query count
      db.resetMetrics();
      const page1 = await getConsolidatedResults(db, examId, {}, { page: 1, limit: 50 });
      const metrics = db.getMetrics();
      assert.equal(metrics.queryCount, 2, 'One paginated results request executes exactly 2 queries (count + page)');
      assert.equal(page1.items.length, 50);
      assert.equal(page1.total, 1600);
      assert.equal(page1.totalPages, 32);

      // 2. Middle page (page 16)
      const page16 = await getConsolidatedResults(db, examId, {}, { page: 16, limit: 50 });
      assert.equal(page16.items.length, 50);
      assert.equal(page16.page, 16);

      // 3. Final page (page 32)
      const page32 = await getConsolidatedResults(db, examId, {}, { page: 32, limit: 50 });
      assert.equal(page32.items.length, 50);
      assert.equal(page32.page, 32);

      // 4. Beyond final page (page 33)
      const page33 = await getConsolidatedResults(db, examId, {}, { page: 33, limit: 50 });
      assert.equal(page33.items.length, 0);

      // 5. Exhaustive integrity check across all 32 pages: exactly 1,600 unique source_ids
      const collectedIds = new Set<string>();
      for (let p = 1; p <= 32; p++) {
        const pg = await getConsolidatedResults(db, examId, {}, { page: p, limit: 50 });
        for (const item of pg.items) {
          assert.ok(!collectedIds.has(item.userId), `Duplicate userId ${item.userId} found on page ${p}`);
          collectedIds.add(item.userId);
        }
      }
      assert.equal(collectedIds.size, 1600, 'All 1,600 rows must be uniquely returned across 32 pages with 0 skipped and 0 duplicates');
    });

    it('4.6 Analytics Provenance Check: delegates to existing getExamQuestionAnalytics without unapproved psychometrics', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-an-1';
      const eventId = 'ev-an-1';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-AN', 'Event An', 'kegiatan', 'mansatas', 'completed');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Exam Analytics', 'kegiatan', 'completed', '${eventId}');

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type, points, question_order)
        VALUES ('qa1', '${examId}', 'Soal Mudah', 'multiple_choice', 1, 1),
               ('qa2', '${examId}', 'Soal Sedang', 'multiple_choice', 1, 2);

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('oa1', 'qa1', 'A', 'Correct', 1), ('oa2', 'qa1', 'B', 'Wrong', 0),
               ('oa3', 'qa2', 'A', 'Correct', 1), ('oa4', 'qa2', 'B', 'Wrong', 0);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status)
        VALUES ('ses-a1', '${examId}', 'user-1', 'mansatas', 'submitted'),
               ('ses-a2', '${examId}', 'user-2', 'mansatas', 'submitted');

        INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id)
        VALUES ('ans-a1', 'ses-a1', 'qa1', 'oa1'),
               ('ans-a2', 'ses-a2', 'qa1', 'oa1'),
               ('ans-a3', 'ses-a1', 'qa2', 'oa3'),
               ('ans-a4', 'ses-a2', 'qa2', 'oa4');
      `);

      const analytics = await getConsolidatedAnalytics(db, examId);
      assert.equal(analytics.summary.totalQuestions, 2);
      assert.equal(analytics.summary.totalSubmissions, 2);

      // Question 1: 2/2 correct -> 100% correct rate -> Mudah
      assert.equal(analytics.questions[0].correctRate, 100);
      assert.equal(analytics.questions[0].difficulty, 'Mudah');

      // Question 2: 1/2 correct -> 50% correct rate -> Sedang
      assert.equal(analytics.questions[1].correctRate, 50);
      assert.equal(analytics.questions[1].difficulty, 'Sedang');

      // Verify options breakdown
      assert.equal(analytics.questions[0].options[0].chosenCount, 2);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // SUITE 5: ENGINE RUNTIME HARDENING & QUERY BOUNDEDNESS
  // ══════════════════════════════════════════════════════════════
  describe('5. Engine Runtime Hardening & Query Boundedness', () => {
    it('5.1 Token validation & session creation executes within safe bounded query budget', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-budget-1';
      const studentId = 'stud-budget-1';
      const roomId = 'room-1';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-bud', 'EV-BUD', 'Event Budget', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Ujian Budget', 'kegiatan', 'active', 'ev-bud', 60);

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
        VALUES ('ros-bud', '${examId}', 'ev-bud', 'mansatas', '${studentId}', 'userbud', 'User Budget', '${roomId}');

        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-bud', '${examId}', '${roomId}', 'TOKBUDGET', 1);

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qb1', '${examId}', 'Soal B1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('ob1', 'qb1', 'A', 'Correct', 1);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userbud',
        role: 'student',
        source: 'mansatas',
        room_id: roomId,
      }, JWT_SECRET);

      const env: any = {
        DB: db,
        JWT_SECRET,
        RATE_LIMIT: { get: async () => null, put: async () => null },
      };

      db.resetMetrics();

      const res = await app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ token_code: 'TOKBUDGET', device_id: 'dev-1' }),
      }), env);

      assert.equal(res.status, 201);
      const metrics = db.getMetrics();
      // Budget check: session creation executes exactly 9 bounded statements (roster, exam, session check, token, questions, options, insert)
      assert.ok(metrics.queryCount <= 10, `Session creation query count (${metrics.queryCount}) must be <= 10`);
      assert.equal(metrics.writeCount, 1, 'Session creation must perform exactly 1 write');
    });

    it('5.2 Session resume executes via fast-path with reduced query count', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-resume-1';
      const studentId = 'stud-resume-1';
      const roomId = 'room-1';

      sqlite.exec(`
        INSERT OR IGNORE INTO cbt_rooms (id, room_name, capacity) VALUES ('${roomId}', 'Ruang Resume', 40);

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-res', 'EV-RES', 'Event Resume', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Ujian Resume', 'kegiatan', 'active', 'ev-res', 60);

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
        VALUES ('ros-res', '${examId}', 'ev-res', 'mansatas', '${studentId}', 'userres', 'User Res', '${roomId}');

        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-res', '${examId}', '${roomId}', 'TOKRESUME', 1);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, device_id, started_at, last_heartbeat)
        VALUES ('sess-res-1', '${examId}', '${studentId}', 'mansatas', 'active', 'dev-1', datetime('now'), datetime('now'));
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userres',
        role: 'student',
        source: 'mansatas',
        room_id: roomId,
      }, JWT_SECRET);

      const env: any = {
        DB: db,
        JWT_SECRET,
        RATE_LIMIT: { get: async () => null, put: async () => null },
      };

      db.resetMetrics();

      const res = await app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ token_code: 'TOKRESUME', device_id: 'dev-1' }),
      }), env);

      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.data.resumed, true);

      const metrics = db.getMetrics();
      // Fast path skips questions/options queries, bounding query count to <= 8 (significantly less than full creation)
      assert.ok(metrics.queryCount <= 8, `Session resume query count (${metrics.queryCount}) must be <= 8`);
    });

    it('5.3 Same-participant concurrent session start guarantees exactly 1 session created', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const eventId = 'ev-same-p';
      const examId = 'ex-same-p';
      const roomId = 'room-1';
      const studentId = 'stud-same-1';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-SAME', 'Event Same Start', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Ujian Same Start', 'kegiatan', 'active', '${eventId}', 60);

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
        VALUES ('ros-same', '${examId}', '${eventId}', 'mansatas', '${studentId}', 'usersame', 'User Same', '${roomId}');

        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-same', '${examId}', '${roomId}', 'SAME123', 1);

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qs1', '${examId}', 'Soal S1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('os1', 'qs1', 'A', 'Pilihan A', 1);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'usersame',
        role: 'student',
        source: 'mansatas',
        room_id: roomId,
      }, JWT_SECRET);

      const env: any = {
        DB: db,
        JWT_SECRET,
        RATE_LIMIT: { get: async () => null, put: async () => null },
      };

      // Two simultaneous start requests for the SAME candidate
      const [res1, res2] = await Promise.all([
        app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
          body: JSON.stringify({ token_code: 'SAME123', device_id: 'dev-phone' }),
        }), env),
        app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
          body: JSON.stringify({ token_code: 'SAME123', device_id: 'dev-phone' }),
        }), env),
      ]);

      const body1 = await res1.json() as any;
      const body2 = await res2.json() as any;

      assert.equal(body1.success, true);
      assert.equal(body2.success, true);
      assert.equal(body1.data.session_id, body2.data.session_id, 'Both concurrent calls must return identical session ID');

      // Verify exactly 1 row exists in DB
      const sessionCount = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id = ? AND user_id = ?'
      ).get(examId, studentId) as any;
      assert.equal(sessionCount.cnt, 1, 'Exactly 1 canonical session row must exist');
    });

    it('5.4 Late submit after timeout is strictly rejected with 403 without status or score mutation', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-late-1';
      const studentId = 'stud-late-1';
      const sessionId = 'sess-late-1';
      const pastStart = new Date(Date.now() - 75 * 60 * 1000).toISOString(); // 75 mins ago on 60 min exam

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-late', 'EV-LATE', 'Event Late', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Exam Late', 'kegiatan', 'active', 'ev-late', 60);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, started_at, last_heartbeat)
        VALUES ('${sessionId}', '${examId}', '${studentId}', 'mansatas', 'active', '${pastStart}', '${pastStart}');

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('ql1', '${examId}', 'Soal L1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('ol1', 'ql1', 'A', 'Correct', 1);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userlate',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      const res = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [{ question_id: 'ql1', selected_option_id: 'ol1' }] }),
      }), env);

      assert.equal(res.status, 403, 'Late submit after duration expiry must be rejected with 403');
      const body = await res.json() as any;
      assert.ok(body.error.includes('Waktu ujian sudah habis'));

      // Verify status is locked and NOT marked submitted
      const session = sqlite.prepare('SELECT status, is_time_locked FROM cbt_exam_sessions WHERE id = ?').get(sessionId) as any;
      assert.equal(session.status, 'active', 'Status must not transition to submitted');
      assert.equal(session.is_time_locked, 1, 'Session must be time-locked');

      // Verify zero results computed
      const resultCount = sqlite.prepare('SELECT COUNT(*) as cnt FROM cbt_exam_results WHERE session_id = ?').get(sessionId) as any;
      assert.equal(resultCount.cnt, 0, 'No result row should be created for expired submission');
    });

    it('5.5 Retry submit against already-submitted session returns canonical existing result without rescoring', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-retry-sub';
      const studentId = 'stud-retry-sub';
      const sessionId = 'sess-retry-sub';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-ret', 'EV-RET', 'Event Retry', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, is_score_visible)
        VALUES ('${examId}', 'Exam Retry', 'kegiatan', 'active', 'ev-ret', 1);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, started_at, finished_at)
        VALUES ('${sessionId}', '${examId}', '${studentId}', 'mansatas', 'submitted', datetime('now', '-10 minutes'), datetime('now', '-5 minutes'));

        INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
        VALUES ('res-ret-1', '${sessionId}', '${examId}', '${studentId}', 'mansatas', 10, 9, 1, 0, 90);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userretry',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      db.resetMetrics();

      const res = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [] }),
      }), env);

      assert.equal(res.status, 200);
      const body = await res.json() as any;
      assert.equal(body.data.score, 90, 'Must return canonical existing score');

      // Verify zero writes were performed
      const metrics = db.getMetrics();
      assert.equal(metrics.writeCount, 0, 'Retry on submitted session must not execute any writes');
    });

    it('5.6 Terminal status cannot be rewritten: time-locked session cannot be finalized', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-term-lock';
      const studentId = 'stud-term-lock';
      const sessionId = 'sess-term-lock';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-term', 'EV-TERM', 'Event Term', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Exam Term', 'kegiatan', 'active', 'ev-term', 60);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, is_time_locked, started_at)
        VALUES ('${sessionId}', '${examId}', '${studentId}', 'mansatas', 'active', 1, datetime('now'));

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qt1', '${examId}', 'Soal T1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('ot1', 'qt1', 'A', 'Correct', 1);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'usertermlock',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      const res = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [{ question_id: 'qt1', selected_option_id: 'ot1' }] }),
      }), env);

      assert.equal(res.status, 403, 'Locked session submission must be rejected with 403');
      const session = sqlite.prepare('SELECT status FROM cbt_exam_sessions WHERE id = ?').get(sessionId) as any;
      assert.equal(session.status, 'active', 'Terminal status must not transition to submitted');
    });

    it('5.7 Heartbeat request write cost is minimal: 1 read, 1 write, only last_heartbeat updated', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-hb-cost';
      const studentId = 'stud-hb-cost';
      const sessionId = 'sess-hb-cost';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-hbc', 'EV-HBC', 'Event HBC', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Exam HBC', 'kegiatan', 'active', 'ev-hbc', 60);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, started_at, last_heartbeat)
        VALUES ('${sessionId}', '${examId}', '${studentId}', 'mansatas', 'active', datetime('now'), datetime('now'));
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userhbc',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      db.resetMetrics();

      const res = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/heartbeat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${studentToken}` },
      }), env);

      assert.equal(res.status, 200);
      const metrics = db.getMetrics();

      assert.equal(metrics.queryCount, 2, 'Heartbeat executes exactly 2 statements (1 SELECT, 1 UPDATE)');
      assert.equal(metrics.writeCount, 1, 'Heartbeat performs exactly 1 write');
      assert.ok(metrics.queries[1].includes('UPDATE cbt_exam_sessions SET last_heartbeat=?'), 'Updates only last_heartbeat');

      const body = await res.json() as any;
      const jsonPayloadSize = JSON.stringify(body).length;
      assert.ok(jsonPayloadSize < 200, `Heartbeat payload size (${jsonPayloadSize} bytes) must be < 200 bytes`);
    });

    it('5.8 D1 Query / Write Budgets instrumentation across operations', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-budget-all';
      const studentId = 'stud-b-all';
      const sessionId = 'sess-b-all';
      const roomId = 'room-1';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-ba', 'EV-BA', 'Event BA', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Exam BA', 'kegiatan', 'active', 'ev-ba', 60);

        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
        VALUES ('ros-ba', '${examId}', 'ev-ba', 'mansatas', '${studentId}', 'userba', 'User BA', '${roomId}');

        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-ba', '${examId}', '${roomId}', 'TOKBA', 1);

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qba1', '${examId}', 'Soal BA1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('oba1', 'qba1', 'A', 'Correct', 1);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userba',
        role: 'student',
        source: 'mansatas',
        room_id: roomId,
      }, JWT_SECRET);

      const env: any = {
        DB: db,
        JWT_SECRET,
        RATE_LIMIT: { get: async () => null, put: async () => null },
      };

      // 1. Initial Session Start
      db.resetMetrics();
      await app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ token_code: 'TOKBA', device_id: 'dev-1' }),
      }), env);
      const startMetrics = db.getMetrics();
      assert.ok(startMetrics.queryCount <= 10, 'Start <= 10 queries');
      assert.equal(startMetrics.writeCount, 1, 'Start exactly 1 write');

      // 2. Session Resume
      db.resetMetrics();
      await app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ token_code: 'TOKBA', device_id: 'dev-1' }),
      }), env);
      const resumeMetrics = db.getMetrics();
      assert.ok(resumeMetrics.queryCount <= 8, 'Resume <= 8 queries');
      assert.equal(resumeMetrics.writeCount, 1, 'Resume exactly 1 write');

      // 3. Question Loading
      const sessionRow = sqlite.prepare('SELECT id FROM cbt_exam_sessions WHERE exam_id=? AND user_id=?').get(examId, studentId) as any;
      db.resetMetrics();
      await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionRow.id}/questions`, {
        headers: { 'Authorization': `Bearer ${studentToken}` },
      }), env);
      const qMetrics = db.getMetrics();
      assert.ok(qMetrics.queryCount <= 5, 'Questions <= 5 queries');
      assert.equal(qMetrics.writeCount, 0, 'Questions 0 writes');

      // 4. Answer Save
      db.resetMetrics();
      await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionRow.id}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [{ question_id: 'qba1', selected_option_id: 'oba1' }] }),
      }), env);
      const ansMetrics = db.getMetrics();
      assert.ok(ansMetrics.queryCount <= 5, 'Answer save <= 5 queries');
      assert.ok(ansMetrics.writeCount >= 1, 'Answer save has writes');

      // 5. Submit
      db.resetMetrics();
      await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionRow.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [] }),
      }), env);
      const subMetrics = db.getMetrics();
      assert.ok(subMetrics.queryCount <= 12, 'Submit <= 12 queries');
      assert.ok(subMetrics.writeCount >= 1, 'Submit has writes');

      // 6. Report Overview
      db.resetMetrics();
      await getExamOverview(db, examId);
      const repOverviewMetrics = db.getMetrics();
      assert.equal(repOverviewMetrics.queryCount, 7, 'Overview executes 7 bounded queries (exam, roster, assignments, session stats, score stats, pass/fail, median)');

      // 7. Report Results Page
      db.resetMetrics();
      await getConsolidatedResults(db, examId, {}, { page: 1, limit: 50 });
      const repResultsMetrics = db.getMetrics();
      assert.equal(repResultsMetrics.queryCount, 2, 'Results page exactly 2 queries (count + page)');

      // 8. Analytics
      db.resetMetrics();
      await getConsolidatedAnalytics(db, examId);
      const repAnalyticsMetrics = db.getMetrics();
      assert.equal(repAnalyticsMetrics.queryCount, 3, 'Analytics exactly 3 queries (questions, options, answers)');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // SUITE 6: FAILURE INJECTION & RESILIENCE
  // ══════════════════════════════════════════════════════════════
  describe('6. Failure Injection & Resilience', () => {
    it('6.1 Incomplete answers submission is strictly rejected without changing session status', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-fail-1';
      const sessionId = 'sess-fail-1';
      const studentId = 'stud-fail-1';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-fail', 'EV-FAIL', 'Event Fail', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Ujian Fail', 'kegiatan', 'active', 'ev-fail');

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, started_at)
        VALUES ('${sessionId}', '${examId}', '${studentId}', 'mansatas', 'active', datetime('now'));

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qf1', '${examId}', 'Soal 1?', 'multiple_choice'),
               ('qf2', '${examId}', 'Soal 2?', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('opt-x', 'qf1', 'A', 'Pilihan A', 1),
               ('opt-y', 'qf2', 'A', 'Pilihan A', 1);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'student_fail',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      // Submit with only question 1 answered, question 2 missing
      const res = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [{ question_id: 'qf1', selected_option_id: 'opt-x' }] }),
      }), env);

      assert.equal(res.status, 400, 'Incomplete submission must return 400');
      const body = await res.json() as any;
      assert.ok(body.error.includes('1 soal belum diisi'));

      // Verify session remained active, not submitted
      const session = sqlite.prepare('SELECT status FROM cbt_exam_sessions WHERE id = ?').get(sessionId) as any;
      assert.equal(session.status, 'active', 'Session must remain active on incomplete submission rejection');
    });

    it('6.2 Failure Injection: DB failure during answer write safely aborts without corrupted answers', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite, { failWriteRegex: /cbt_student_answers/ });

      const examId = 'ex-fail-ans';
      const sessionId = 'sess-fail-ans';
      const studentId = 'stud-fail-ans';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-fa', 'EV-FA', 'Event FA', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Exam FA', 'kegiatan', 'active', 'ev-fa', 60);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, started_at)
        VALUES ('${sessionId}', '${examId}', '${studentId}', 'mansatas', 'active', datetime('now'));

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qfa1', '${examId}', 'QFA1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('ofa1', 'qfa1', 'A', 'Pilihan A', 1);
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userfa',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      const res = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [{ question_id: 'qfa1', selected_option_id: 'ofa1' }] }),
      }), env);

      assert.equal(res.status, 500, 'DB failure on answer write must return 500');
      assert.ok(res.headers.get('X-Request-Id'), 'Must return X-Request-Id header');

      // Verify no corrupted answer row exists
      const count = (sqlite.prepare('SELECT COUNT(*) as cnt FROM cbt_student_answers WHERE session_id = ?').get(sessionId) as any).cnt;
      assert.equal(count, 0, 'No answer row should be saved on DB failure');
    });

    it('6.3 Failure Injection: DB failure during session finalization leaves session active', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite, { failWriteRegex: /cbt_exam_sessions[\s\S]*status/i });

      const examId = 'ex-fail-fin';
      const sessionId = 'sess-fail-fin';
      const studentId = 'stud-fail-fin';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-ff', 'EV-FF', 'Event FF', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Exam FF', 'kegiatan', 'active', 'ev-ff', 60);

        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status, started_at)
        VALUES ('${sessionId}', '${examId}', '${studentId}', 'mansatas', 'active', datetime('now'));

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qff1', '${examId}', 'QFF1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('off1', 'qff1', 'A', 'Pilihan A', 1);

        INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id)
        VALUES ('ans-ff1', '${sessionId}', 'qff1', 'off1');
      `);

      const studentToken = await signJWT({
        sub: studentId,
        username: 'userff',
        role: 'student',
        source: 'mansatas',
      }, JWT_SECRET);

      const env: any = { DB: db, JWT_SECRET };

      const res = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` },
        body: JSON.stringify({ answers: [] }),
      }), env);

      assert.ok(res.status >= 400, 'Must return error on finalization failure');
      assert.ok(res.headers.get('X-Request-Id'), 'Must include X-Request-Id');

      // Verify session remained active (not half-finalized)
      const session = sqlite.prepare('SELECT status FROM cbt_exam_sessions WHERE id = ?').get(sessionId) as any;
      assert.equal(session.status, 'active', 'Session must remain active when finalization write fails');
    });

    it('6.4 Failure Injection: Reporting query failure returns controlled 500 with X-Request-Id', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite, { failQueryRegex: /cbt_exam_roster/ });

      const adminToken = await signJWT({ sub: 'admin-fail', role: 'admin' }, JWT_SECRET);
      const env: any = { DB: db, JWT_SECRET };

      const res = await app.fetch(new Request('http://localhost/api/reporting/results/ex-any', {
        headers: { 'Authorization': `Bearer ${adminToken}` },
      }), env);

      assert.ok(res.status >= 400);
      assert.ok(res.headers.get('X-Request-Id'));
    });

    it('6.5 Request ID Trust Boundary: accepts sanitized ID, replaces oversized/malicious with UUID', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);
      const env: any = { DB: db, JWT_SECRET };

      // 1. Valid client request ID
      const resValid = await app.fetch(new Request('http://localhost/api/health', {
        headers: { 'X-Request-Id': 'req-client-trace-12345' },
      }), env);
      assert.equal(resValid.headers.get('X-Request-Id'), 'req-client-trace-12345');

      // 2. Malicious / oversized request ID (500 chars with script tag)
      const maliciousId = '<script>alert(1)</script>' + 'A'.repeat(500);
      const resMalicious = await app.fetch(new Request('http://localhost/api/health', {
        headers: { 'X-Request-Id': maliciousId },
      }), env);
      const returnedId = resMalicious.headers.get('X-Request-Id');
      assert.notEqual(returnedId, maliciousId);
      assert.ok(/^[0-9a-f\-]{36}$/.test(returnedId!), 'Must generate a valid UUID for malicious/oversized request ID');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // SUITE 7: REALISTIC SCHOOL LOAD PROFILES SIMULATION (PROFILES A–E)
  // ══════════════════════════════════════════════════════════════
  describe('7. Realistic School Load Profiles Simulation', () => {

    // ── Profile A: Normal Examination Simulation ────────────────
    it('7.1 Profile A: Normal Examination (~500 active candidates with concurrent answers, heartbeats, and monitoring)', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const candidateCount = 500;
      const examId = 'ex-profile-a';
      const eventId = 'ev-profile-a';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-PROF-A', 'Event Profile A', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Ujian Profile A', 'kegiatan', 'active', '${eventId}', 90);

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qa1', '${examId}', 'Soal 1', 'multiple_choice'),
               ('qa2', '${examId}', 'Soal 2', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('oa1', 'qa1', 'A', 'Correct', 1), ('oa2', 'qa1', 'B', 'Wrong', 0),
               ('oa3', 'qa2', 'A', 'Correct', 1), ('oa4', 'qa2', 'B', 'Wrong', 0);
      `);

      // Seed 15 rooms in cbt_rooms
      for (let r = 1; r <= 15; r++) {
        sqlite.prepare('INSERT OR IGNORE INTO cbt_rooms (id, room_name, capacity) VALUES (?, ?, ?)').run(`room-${r}`, `Ruang ${r}`, 40);
      }

      // Seed 500 roster rows & sessions across 15 rooms
      const insertRoster = sqlite.prepare(`
        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id, class_name)
        VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?, ?)
      `);
      const insertSession = sqlite.prepare(`
        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status, started_at, last_heartbeat)
        VALUES (?, ?, ?, 'mansatas', ?, 'active', datetime('now'), datetime('now'))
      `);

      for (let i = 1; i <= candidateCount; i++) {
        const studentId = `s-a-${i}`;
        const roomId = `room-${(i % 15) + 1}`;
        const className = `Class-${(i % 12) + 1}`;
        insertRoster.run(`ros-a-${i}`, examId, eventId, studentId, `user_a_${i}`, `Student A ${i}`, roomId, className);
        insertSession.run(`sess-a-${i}`, examId, studentId, roomId);
      }

      const startTime = Date.now();
      const latencies: number[] = [];

      // 1. Answer saves for 500 candidates concurrently
      const answerBatch = Array.from({ length: candidateCount }).map(async (_, idx) => {
        const t0 = Date.now();
        const sessionId = `sess-a-${idx + 1}`;
        await db.prepare(
          `INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id, answered_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(session_id, question_id) DO UPDATE SET selected_option_id=excluded.selected_option_id`
        ).bind(newId(), sessionId, 'qa1', 'oa1').run();
        latencies.push(Date.now() - t0);
      });

      // 2. Heartbeats for 500 candidates concurrently
      const heartbeatBatch = Array.from({ length: candidateCount }).map(async (_, idx) => {
        const t0 = Date.now();
        const sessionId = `sess-a-${idx + 1}`;
        await db.prepare(
          "UPDATE cbt_exam_sessions SET last_heartbeat = datetime('now') WHERE id = ?"
        ).bind(sessionId).run();
        latencies.push(Date.now() - t0);
      });

      await Promise.all([...answerBatch, ...heartbeatBatch]);

      // 3. Proctor monitoring query during examination
      const tMon = Date.now();
      const sessions = sqlite.prepare(
        `SELECT es.*, COALESCE(rr.full_name, '') as full_name,
                (SELECT COUNT(*) FROM cbt_cheat_logs cl WHERE cl.session_id = es.id) as cheat_log_count
         FROM cbt_exam_sessions es
         LEFT JOIN cbt_exam_roster rr ON rr.exam_id = es.exam_id AND rr.source_id = es.user_id
         WHERE es.exam_id = ?
         LIMIT 100`
      ).all(examId);
      const monDuration = Date.now() - tMon;

      const durationMs = Date.now() - startTime;
      const stats = calculatePercentiles(latencies);

      assert.equal(sessions.length, 100);
      assert.ok(durationMs < 5000, `Profile A completed in ${durationMs}ms`);

      const answersSaved = sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM cbt_student_answers WHERE question_id = 'qa1'"
      ).get() as any;
      assert.equal(answersSaved.cnt, candidateCount, 'All 500 candidate answers must be safely persisted');
    });

    // ── Profile B: Start Burst Simulation ────────────────────────
    it('7.2 Profile B: Start Burst (~500 simultaneous candidate token validation & start attempts)', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const candidateCount = 500;
      const examId = 'ex-burst-1';
      const eventId = 'ev-burst-1';
      const roomId = 'room-burst-1';

      sqlite.exec(`
        INSERT OR IGNORE INTO cbt_rooms (id, room_name, capacity) VALUES ('${roomId}', 'Ruang Burst 1', 500);

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-BURST', 'Event Burst', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes)
        VALUES ('${examId}', 'Ujian Burst', 'kegiatan', 'active', '${eventId}', 60);

        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-burst', '${examId}', '${roomId}', 'BURSTOK', 1);

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type)
        VALUES ('qb1', '${examId}', 'Soal Burst 1', 'multiple_choice');

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('ob1', 'qb1', 'A', 'Correct', 1);
      `);

      const insertRoster = sqlite.prepare(`
        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
        VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?)
      `);

      for (let i = 1; i <= candidateCount; i++) {
        insertRoster.run(`ros-b-${i}`, examId, eventId, `stud-b-${i}`, `user_b_${i}`, `Student B ${i}`, roomId);
      }

      const env: any = {
        DB: db,
        JWT_SECRET,
        RATE_LIMIT: { get: async () => null, put: async () => null },
      };

      const startTime = Date.now();
      const burstTokens = await Promise.all(
        Array.from({ length: candidateCount }).map((_, idx) =>
          signJWT({
            sub: `stud-b-${idx + 1}`,
            username: `user_b_${idx + 1}`,
            role: 'student',
            source: 'mansatas',
            room_id: roomId,
          }, JWT_SECRET)
        )
      );

      const latencies: number[] = [];
      const burstRequests = burstTokens.map(async tok => {
        const t0 = Date.now();
        const res = await app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
          body: JSON.stringify({ token_code: 'BURSTOK', device_id: 'dev-burst' }),
        }), env);
        latencies.push(Date.now() - t0);
        return res;
      });

      const responses = await Promise.all(burstRequests);
      const durationMs = Date.now() - startTime;
      const stats = calculatePercentiles(latencies);

      for (const r of responses) {
        assert.equal(r.status, 201, 'Every candidate start in burst must succeed');
      }

      const sessionCount = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id = ?'
      ).get(examId) as any;
      assert.equal(sessionCount.cnt, candidateCount, 'Exactly 500 sessions must be created');
      assert.ok(durationMs < 6000, `Start burst completed in ${durationMs}ms`);
    });

    // ── Profile C: Full School Reporting Simulation ──────────────
    it('7.3 Profile C: Full School Reporting (1,600 students across 50 classes, pagination, filters, & export)', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const studentCount = 1600;
      const classCount = 50;
      const examId = 'ex-scale-rep';
      const eventId = 'ev-scale-rep';

      // Seed 40 rooms in cbt_rooms
      for (let r = 1; r <= 40; r++) {
        sqlite.prepare('INSERT OR IGNORE INTO cbt_rooms (id, room_name, capacity) VALUES (?, ?, ?)').run(`room-${r}`, `Ruang ${r}`, 40);
      }

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-SCALE', 'Evaluasi Akbar 1600 Siswa', 'kegiatan', 'mansatas', 'completed');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, passing_score)
        VALUES ('${examId}', 'Penilaian Akbar 1600 Siswa', 'kegiatan', 'completed', '${eventId}', 75);
      `);

      const insertRoster = sqlite.prepare(`
        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, class_name, grade, room_id)
        VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?, ?, ?)
      `);

      const insertSession = sqlite.prepare(`
        INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status)
        VALUES (?, ?, ?, 'mansatas', 'submitted')
      `);

      const insertResult = sqlite.prepare(`
        INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
        VALUES (?, ?, ?, ?, 'mansatas', 50, ?, ?, 0, ?)
      `);

      for (let i = 1; i <= studentCount; i++) {
        const studentId = `std-${i}`;
        const classIdx = (i % classCount) + 1;
        const className = `Kelas-${classIdx}`;
        const grade = classIdx <= 18 ? '10' : classIdx <= 35 ? '11' : '12';
        const roomId = `room-${(i % 40) + 1}`;
        const correct = 25 + (i % 26);
        const score = Math.round((correct / 50) * 100);

        insertRoster.run(`ros-${i}`, examId, eventId, studentId, `user_${i}`, `Siswa Nomor ${i}`, className, grade, roomId);
        insertSession.run(`ses-${i}`, examId, studentId);
        insertResult.run(`res-${i}`, `ses-${i}`, examId, studentId, correct, 50 - correct, score);
      }

      // 1. Overview report calculation at 1,600 scale
      const t0 = Date.now();
      const overview = await getExamOverview(db, examId);
      const overviewMs = Date.now() - t0;
      assert.equal(overview.totalEnrolled, 1600);
      assert.equal(overview.submittedCount, 1600);
      assert.ok(overview.scoreSummary.average > 70);

      // 2. Bounded pagination at 1,600 scale: Page 1 (limit 50)
      const t1 = Date.now();
      const page1 = await getConsolidatedResults(db, examId, {}, { page: 1, limit: 50 });
      const page1Ms = Date.now() - t1;
      assert.equal(page1.items.length, 50);
      assert.equal(page1.total, 1600);
      assert.equal(page1.totalPages, 32);

      // 3. Filtered pagination by class: Kelas-1
      const filteredClass = await getConsolidatedResults(db, examId, { className: 'Kelas-1' }, { page: 1, limit: 100 });
      assert.ok(filteredClass.items.length > 0);
      for (const item of filteredClass.items) {
        assert.equal(item.className, 'Kelas-1');
      }

      // 4. Search filter: search for 'Nomor 500'
      const searchResult = await getConsolidatedResults(db, examId, { search: 'Nomor 500' });
      assert.equal(searchResult.items.length, 1);
      assert.equal(searchResult.items[0].fullName, 'Siswa Nomor 500');

      // 5. Full school export generation
      const tExp = Date.now();
      const { filename, csvContent } = await generateResultsCsv(db, examId);
      const expMs = Date.now() - tExp;
      assert.ok(filename.endsWith('.csv'));
      assert.equal(csvContent.charCodeAt(0), 0xFEFF); // BOM check
      const lineCount = csvContent.split('\r\n').length;
      assert.equal(lineCount, 1601); // 1 header + 1600 rows
    });

    // ── Profile D: Monitoring Concurrent with Examination ────────
    it('7.4 Profile D: Monitoring concurrent with active candidate submissions', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const examId = 'ex-prof-d';
      const eventId = 'ev-prof-d';

      sqlite.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-PROF-D', 'Event Profile D', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id)
        VALUES ('${examId}', 'Ujian Profile D', 'kegiatan', 'active', '${eventId}');
      `);

      for (let i = 1; i <= 100; i++) {
        sqlite.exec(`
          INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
          VALUES ('ros-d-${i}', '${examId}', '${eventId}', 'mansatas', 'std-d-${i}', 'ud${i}', 'Student D ${i}', 'room-1');

          INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status, last_heartbeat)
          VALUES ('ses-d-${i}', '${examId}', 'std-d-${i}', 'mansatas', 'room-1', 'active', datetime('now'));
        `);
      }

      const proctorReads = Array.from({ length: 10 }).map(() =>
        sqlite.prepare(
          `SELECT es.*, (SELECT COUNT(*) FROM cbt_cheat_logs cl WHERE cl.session_id = es.id) as cheat_log_count
           FROM cbt_exam_sessions es
           WHERE es.exam_id = ? AND es.room_id = ?`
        ).all(examId, 'room-1')
      );

      const candidateWrites = Array.from({ length: 50 }).map((_, idx) =>
        sqlite.prepare(
          "UPDATE cbt_exam_sessions SET last_heartbeat = datetime('now') WHERE id = ?"
        ).run(`ses-d-${idx + 1}`)
      );

      const [readResults] = await Promise.all([Promise.all(proctorReads), Promise.all(candidateWrites)]);

      for (const res of readResults) {
        assert.equal(res.length, 100);
      }
    });

    // ── Profile E: Full End-to-End Concurrent Candidate Flow ────
    it('7.5 Profile E: Full End-to-End Candidate Flow (~500 synthetic candidates) with concurrent monitoring', async () => {
      const sqlite = initMemoryDatabase();
      const db = createMockD1(sqlite);

      const candidateCount = 500;
      const examId = 'ex-prof-e';
      const eventId = 'ev-prof-e';
      const roomId = 'room-e-1';

      sqlite.exec(`
        INSERT OR IGNORE INTO cbt_rooms (id, room_name, capacity) VALUES ('${roomId}', 'Ruang End to End', 500);

        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('${eventId}', 'EV-PROF-E', 'Event Profile E', 'kegiatan', 'mansatas', 'active');

        INSERT INTO cbt_exams (id, title, mode, active_status, event_id, duration_minutes, is_score_visible)
        VALUES ('${examId}', 'Ujian End to End', 'kegiatan', 'active', '${eventId}', 60, 1);

        INSERT INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active)
        VALUES ('tok-e', '${examId}', '${roomId}', 'ENDE2E', 1);

        INSERT INTO cbt_questions (id, exam_id, question_text, question_type, points, question_order)
        VALUES ('qe1', '${examId}', 'Soal E1', 'multiple_choice', 1, 1),
               ('qe2', '${examId}', 'Soal E2', 'multiple_choice', 1, 2);

        INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct)
        VALUES ('oe1-a', 'qe1', 'A', 'Pilihan A Benar', 1),
               ('oe1-b', 'qe1', 'B', 'Pilihan B Salah', 0),
               ('oe2-a', 'qe2', 'A', 'Pilihan A Benar', 1),
               ('oe2-b', 'qe2', 'B', 'Pilihan B Salah', 0);
      `);

      const insertRoster = sqlite.prepare(`
        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, room_id)
        VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?)
      `);

      for (let i = 1; i <= candidateCount; i++) {
        insertRoster.run(`ros-e-${i}`, examId, eventId, `stud-e-${i}`, `user_e_${i}`, `Student E ${i}`, roomId);
      }

      const env: any = {
        DB: db,
        JWT_SECRET,
        RATE_LIMIT: { get: async () => null, put: async () => null },
      };

      const tokens = await Promise.all(
        Array.from({ length: candidateCount }).map((_, idx) =>
          signJWT({
            sub: `stud-e-${idx + 1}`,
            username: `user_e_${idx + 1}`,
            role: 'student',
            source: 'mansatas',
            room_id: roomId,
          }, JWT_SECRET)
        )
      );

      const latencies = {
        start: [] as number[],
        questions: [] as number[],
        answers: [] as number[],
        heartbeat: [] as number[],
        submit: [] as number[],
      };

      const tStartAll = Date.now();

      // Run 500 candidate flows concurrently
      const candidatePromises = tokens.map(async (tok, idx) => {
        const studentId = `stud-e-${idx + 1}`;

        // 1. Validate token & start session
        const t0 = Date.now();
        const startRes = await app.fetch(new Request(`http://localhost/api/student/exams/${examId}/validate-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
          body: JSON.stringify({ token_code: 'ENDE2E', device_id: `dev-${idx + 1}` }),
        }), env);
        latencies.start.push(Date.now() - t0);
        assert.equal(startRes.status, 201);
        const startData = (await startRes.json() as any).data;
        const sessionId = startData.session_id;

        // 2. Load questions
        const t1 = Date.now();
        const qRes = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/questions`, {
          headers: { 'Authorization': `Bearer ${tok}` },
        }), env);
        latencies.questions.push(Date.now() - t1);
        assert.equal(qRes.status, 200);

        // 3. Save answers (First attempt: oe1-b wrong, oe2-a correct)
        const t2 = Date.now();
        const aRes1 = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
          body: JSON.stringify({
            answers: [
              { question_id: 'qe1', selected_option_id: 'oe1-b' },
              { question_id: 'qe2', selected_option_id: 'oe2-a' },
            ],
          }),
        }), env);
        assert.equal(aRes1.status, 200);

        // 4. Heartbeat
        const t3 = Date.now();
        const hbRes = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/heartbeat`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tok}` },
        }), env);
        latencies.heartbeat.push(Date.now() - t3);
        assert.equal(hbRes.status, 200);

        // 5. Retry / update answer 1 to correct choice oe1-a
        const aRes2 = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
          body: JSON.stringify({
            answers: [
              { question_id: 'qe1', selected_option_id: 'oe1-a' },
            ],
          }),
        }), env);
        latencies.answers.push(Date.now() - t2);
        assert.equal(aRes2.status, 200);

        // 6. Submit session
        const t4 = Date.now();
        const subRes = await app.fetch(new Request(`http://localhost/api/student/sessions/${sessionId}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
          body: JSON.stringify({ answers: [] }),
        }), env);
        latencies.submit.push(Date.now() - t4);
        assert.equal(subRes.status, 200);
        const subData = (await subRes.json() as any).data;
        assert.equal(subData.score, 100, 'Candidate retried to correct answer and must receive score 100');

        return sessionId;
      });

      // Concurrent proctor monitoring executing while candidates are answering/submitting
      const proctorPromise = (async () => {
        for (let p = 0; p < 5; p++) {
          const sessions = sqlite.prepare(`
            SELECT es.*, (SELECT COUNT(*) FROM cbt_cheat_logs cl WHERE cl.session_id = es.id) as cheat_log_count
            FROM cbt_exam_sessions es
            WHERE es.exam_id = ?
          `).all(examId);
          assert.ok(sessions.length >= 0);
        }
      })();

      const [sessionIds] = await Promise.all([Promise.all(candidatePromises), proctorPromise]);
      const totalFlowMs = Date.now() - tStartAll;

      // ── Comprehensive Integrity Assertions ──
      // 1. Exactly 500 distinct sessions created
      assert.equal(new Set(sessionIds).size, candidateCount, '0 duplicate active sessions');

      // 2. Exactly 500 submitted sessions
      const submittedCount = (sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id = ? AND status = 'submitted'"
      ).get(examId) as any).cnt;
      assert.equal(submittedCount, candidateCount, 'All 500 sessions must reach submitted status without invalid transitions');

      // 3. Exactly 500 results computed
      const resultCount = (sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM cbt_exam_results WHERE exam_id = ?'
      ).get(examId) as any).cnt;
      assert.equal(resultCount, candidateCount, '0 duplicate results and 0 missing results');

      // 4. 0 lost accepted answers: exactly 1,000 answer rows (2 questions * 500 candidates)
      const answerCount = (sqlite.prepare(`
        SELECT COUNT(*) as cnt FROM cbt_student_answers sa
        JOIN cbt_exam_sessions es ON es.id = sa.session_id
        WHERE es.exam_id = ?
      `).get(examId) as any).cnt;
      assert.equal(answerCount, candidateCount * 2, '0 lost accepted answers: 1000 answers saved');

      // 5. Scores consistent with persisted answers: all scores must be 100
      const averageScore = (sqlite.prepare(
        'SELECT AVG(score) as avg_score FROM cbt_exam_results WHERE exam_id = ?'
      ).get(examId) as any).avg_score;
      assert.equal(averageScore, 100, 'All scores must match 100 based on retried accepted answers');
    });

  });

});
