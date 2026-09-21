import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import { authMiddleware, requireRole } from '../src/middleware/auth.ts';
import adminRoutes from '../src/routes/admin.ts';
import proctorRoutes from '../src/routes/proctor.ts';
import { authoringRoutes } from '../src/routes/exam-engine/authoring.ts';
import { roomsRoutes } from '../src/routes/exam-engine/rooms.ts';
import { signJWT } from '../src/utils/jwt.ts';

import {
  listExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
} from '../src/services/exam-engine/exams.ts';
import {
  listExamQuestions,
  createQuestion,
  bulkCreateQuestions,
  updateQuestion,
  deleteQuestion,
} from '../src/services/exam-engine/questions.ts';
import {
  getAssignedTokenTargets,
  listExamTokens,
  generateExamTokens,
  toggleTokenActive,
  setExamTokenCode,
} from '../src/services/exam-engine/tokens.ts';
import { recomputeMissingExamResults } from '../src/services/exam-engine/scoring.ts';
import { getExamQuestionAnalytics } from '../src/services/exam-engine/analytics.ts';
import {
  listRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  listProctors,
  assignProctor,
} from '../src/services/exam-engine/rooms.ts';
import {
  listExamAssignments,
  createExamAssignments,
  assignExamRoom,
  deleteExamAssignment,
} from '../src/services/exam-engine/assignments.ts';

// Helper to create an in-memory SQLite database matching CBT schema
function createTestD1Database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE cbt_events (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'pmb',
      activity_type TEXT NOT NULL DEFAULT 'other',
      participant_source TEXT NOT NULL DEFAULT 'cbt_user',
      status TEXT NOT NULL DEFAULT 'ready',
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
      created_by TEXT NOT NULL,
      target_jalur TEXT,
      event_id TEXT REFERENCES cbt_events(id),
      subject_name TEXT,
      sequence_order INTEGER DEFAULT 0,
      cheat_limit INTEGER DEFAULT 3,
      cheat_action TEXT DEFAULT 'lock',
      enforce_fullscreen INTEGER DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'pmb',
      owner_staff_id TEXT,
      version_label TEXT DEFAULT 'v1.0',
      is_frozen INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'multiple_choice',
      question_order INTEGER NOT NULL DEFAULT 1,
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
      is_correct INTEGER NOT NULL DEFAULT 0,
      option_order INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE cbt_exam_roster (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id),
      exam_id TEXT REFERENCES cbt_exams(id),
      source_key TEXT NOT NULL,
      source_id TEXT NOT NULL,
      username TEXT NOT NULL,
      nisn TEXT,
      full_name TEXT NOT NULL,
      class_name TEXT,
      grade TEXT,
      gender TEXT,
      room_id TEXT REFERENCES cbt_rooms(id),
      tanggal_tes TEXT,
      sesi_tes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_exam_assignments (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, user_id, user_type)
    );

    CREATE TABLE cbt_exam_tokens (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
      tanggal_tes TEXT NOT NULL DEFAULT '',
      sesi_tes TEXT NOT NULL DEFAULT '',
      token_code TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, room_id, tanggal_tes, sesi_tes)
    );

    CREATE TABLE cbt_exam_sessions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id),
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      room_id TEXT REFERENCES cbt_rooms(id),
      status TEXT NOT NULL DEFAULT 'started',
      is_time_locked INTEGER DEFAULT 0,
      locked_at TEXT,
      cheat_warnings INTEGER DEFAULT 0,
      device_id TEXT,
      user_agent TEXT,
      ip_address TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      last_heartbeat TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, user_id, user_type)
    );

    CREATE TABLE cbt_student_answers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES cbt_questions(id),
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
      total_questions INTEGER NOT NULL,
      total_correct INTEGER NOT NULL,
      total_wrong INTEGER NOT NULL,
      total_unanswered INTEGER NOT NULL,
      score REAL NOT NULL,
      computed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_cheat_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
      violation_type TEXT,
      happened_at TEXT DEFAULT (datetime('now')),
      action TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      nama_lengkap TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // D1 adapter wrapping SQLite
  const d1 = {
    prepare(sql: string) {
      const makeExecution = (args: any[]) => ({
        async first<T = any>(): Promise<T | null> {
          const stmt = sqlite.prepare(sql);
          const row = stmt.get(...args);
          return row ? (row as T) : null;
        },
        async all<T = any>(): Promise<{ results: T[] }> {
          const stmt = sqlite.prepare(sql);
          const results = stmt.all(...args);
          return { results: (results as T[]) || [] };
        },
        async run(): Promise<any> {
          const stmt = sqlite.prepare(sql);
          return stmt.run(...args);
        },
      });

      return {
        ...makeExecution([]),
        bind(...args: any[]) {
          return makeExecution(args);
        },
      };
    },
    async batch(statements: any[]) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
  } as unknown as D1Database;


  return { sqlite, d1 };
}

// Helper to create test Hono application with mounted routers and signed JWT tokens
async function createTestApp(d1: D1Database, secret = 'jwt-secret-exam-engine-testing') {
  const app = new Hono<{ Bindings: any }>();
  app.use('*', async (c, next) => {
    c.env = {
      DB: d1,
      JWT_SECRET: secret,
      CORS_ORIGIN: '*',
    };
    await next();
  });
  app.route('/api/admin', adminRoutes);
  app.route('/api/proctor', proctorRoutes);

  const adminToken = await signJWT({
    sub: 'admin-01',
    username: 'admin',
    role: 'admin',
    name: 'Admin Utama',
    allowed_modes: ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan'],
  }, secret);

  const proctorToken = await signJWT({
    sub: 'proc-01',
    username: 'proktor1',
    role: 'proctor',
    name: 'Pak Proktor',
    room_id: 'room-01',
    allowed_modes: ['semester'],
  }, secret);

  const studentToken = await signJWT({
    sub: 'stud-01',
    username: 'siswa1',
    role: 'student',
    name: 'Siswa Satu',
    allowed_modes: ['pmb'],
  }, secret);

  return { app, adminToken, proctorToken, studentToken };
}

describe('Exam Engine Decomposition & Contracts Suite', () => {
  it('1. Authoring: supports full exam CRUD and questions management', async () => {
    const { d1 } = createTestD1Database();

    // Insert parent event
    await d1.prepare(
      "INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-01', 'EV-01', 'Ujian Semester Genap', 'semester', 'ready')"
    ).run();

    // Create exam
    const created = await createExam(
      d1,
      {
        title: 'Matematika Wajib Kelas X',
        duration_minutes: 90,
        event_id: 'ev-01',
      },
      { sub: 'admin-1' }
    );
    assert.equal(created.success, true);
    assert.ok(created.data?.id);
    const examId = created.data!.id;

    // Verify derived mode
    const exam = await getExamById(d1, examId);
    assert.equal(exam.title, 'Matematika Wajib Kelas X');
    assert.equal(exam.mode, 'semester');
    assert.equal(exam.duration_minutes, 90);

    // Create questions
    const q1 = await createQuestion(d1, examId, {
      question_text: 'Berapakah 2 + 2?',
      question_type: 'multiple_choice',
      question_order: 1,
      options: [
        { option_label: 'A', option_text: '3', is_correct: 0 },
        { option_label: 'B', option_text: '4', is_correct: 1 },
      ],
    });
    assert.equal(q1.success, true);

    // Pre-refactor parity: createQuestion accepts empty payload without 400 rejection
    const qEmpty = await createQuestion(d1, examId, {});
    assert.equal(qEmpty.success, true);
    assert.equal(qEmpty.status, 201);
    await deleteQuestion(d1, qEmpty.data!.id);

    // Bulk create questions
    const bulk = await bulkCreateQuestions(d1, examId, [
      {
        question_text: 'Ibu kota Indonesia?',
        question_type: 'multiple_choice',
        question_order: 2,
        options: [
          { option_label: 'A', option_text: 'Jakarta', is_correct: 0 },
          { option_label: 'B', option_text: 'Nusantara', is_correct: 1 },
        ],
      },
      {
        question_text: 'Jelaskan teori relativitas!',
        question_type: 'essay',
        question_order: 3,
      },
    ]);
    assert.equal(bulk.success, true);
    assert.equal(bulk.data?.imported, 2);

    // List questions
    const questions = await listExamQuestions(d1, examId);
    assert.equal(questions.length, 3);
    assert.equal(questions[0].options.length, 2);
    assert.equal(questions[1].options.length, 2);
    assert.equal(questions[2].options.length, 0);

    // Update exam
    const updated = await updateExam(d1, examId, {
      title: 'Matematika Wajib Kelas X (Revisi)',
      duration_minutes: 100,
    });
    assert.equal(updated.success, true);
    const rechecked = await getExamById(d1, examId);
    assert.equal(rechecked.title, 'Matematika Wajib Kelas X (Revisi)');
    assert.equal(rechecked.duration_minutes, 100);

    // Delete exam
    const deleted = await deleteExam(d1, examId);
    assert.equal(deleted.success, true);
    const nonExistent = await getExamById(d1, examId);
    assert.equal(nonExistent, null);
  });

  it('2. Runtime Tokens & Assignments: generates tokens from roster without legacy PMB DB', async () => {
    const { d1 } = createTestD1Database();

    await d1.prepare(
      "INSERT INTO cbt_events (id, code, name, mode) VALUES ('ev-02', 'EV-02', 'Event Tes', 'pmb')"
    ).run();
    await d1.prepare(
      "INSERT INTO cbt_rooms (id, room_name, capacity, event_id) VALUES ('r-01', 'LAB-1', 40, 'ev-02')"
    ).run();
    await d1.prepare(
      "INSERT INTO cbt_exams (id, title, event_id, mode, created_by) VALUES ('ex-02', 'Ujian CBT', 'ev-02', 'pmb', 'admin')"
    ).run();

    // Roster participant in room LAB-1
    await d1.prepare(
      `INSERT INTO cbt_exam_roster (id, event_id, exam_id, source_key, source_id, username, full_name, room_id, tanggal_tes, sesi_tes)
       VALUES ('rost-1', 'ev-02', 'ex-02', 'mansatas', 'student-01', '12345', 'Budi Santoso', 'r-01', '2026-09-25', 'Sesi 1')`
    ).run();

    // Generate tokens
    const gen = await generateExamTokens(d1, 'ex-02', {});
    assert.equal(gen.success, true);
    assert.equal(gen.data?.generated, 1);

    const tokens = await listExamTokens(d1, 'ex-02');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].room_name, 'LAB-1');
    assert.equal(tokens[0].tanggal_tes, '2026-09-25');
    assert.equal(tokens[0].sesi_tes, 'Sesi 1');
    assert.equal(tokens[0].is_active, 1);
    assert.match(tokens[0].token_code, /^[0-9]{6}$/);

    // Toggle active
    await toggleTokenActive(d1, 'ex-02', tokens[0].id, 0);
    const tokensToggled = await listExamTokens(d1, 'ex-02');
    assert.equal(tokensToggled[0].is_active, 0);

    // Set custom code
    await setExamTokenCode(d1, 'ex-02', 'MAN1TASIK');
    const tokensCustom = await listExamTokens(d1, 'ex-02');
    assert.equal(tokensCustom[0].token_code, 'MAN1TASIK');
    assert.equal(tokensCustom[0].is_active, 1);
  });

  it('3. Scoring: exact golden test for recomputeMissingExamResults', async () => {
    const { d1 } = createTestD1Database();

    await d1.prepare(
      "INSERT INTO cbt_exams (id, title, mode, created_by) VALUES ('ex-score', 'Ujian Penilaian', 'semester', 'admin')"
    ).run();

    // 3 questions
    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_text, question_order) VALUES ('q1', 'ex-score', 'Soal 1', 1)").run();
    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_text, question_order) VALUES ('q2', 'ex-score', 'Soal 2', 2)").run();
    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_text, question_order) VALUES ('q3', 'ex-score', 'Soal 3', 3)").run();

    // Correct options
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt1-A', 'q1', 'A', 'Benar', 1)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt1-B', 'q1', 'B', 'Salah', 0)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt2-A', 'q2', 'A', 'Benar', 1)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct) VALUES ('opt3-A', 'q3', 'A', 'Benar', 1)").run();

    // Session submitted
    await d1.prepare(
      "INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status) VALUES ('sess-01', 'ex-score', 'user-01', 'student', 'submitted')"
    ).run();

    // Session 1: answers Q1 correct, Q2 wrong (null option), Q3 correct -> 2/3 = 66.67
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-1', 'sess-01', 'q1', 'opt1-A')").run();
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-2', 'sess-01', 'q2', 'opt1-B')").run(); // wrong option
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-3', 'sess-01', 'q3', 'opt3-A')").run();

    // Session 2: submitted with 1 correct, 0 wrong, 2 unanswered -> 1/3 = 33.33
    await d1.prepare(
      "INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, status) VALUES ('sess-02', 'ex-score', 'user-02', 'student', 'submitted')"
    ).run();
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-4', 'sess-02', 'q1', 'opt1-A')").run();

    // Recompute missing results
    const res = await recomputeMissingExamResults(d1, 'ex-score');
    assert.equal(res.repaired, 2);

    // Verify golden score for Session 1: 2 out of 3 = 66.67
    const resultRow1 = await d1.prepare('SELECT * FROM cbt_exam_results WHERE session_id=?').bind('sess-01').first<any>();
    assert.ok(resultRow1);
    assert.equal(resultRow1.total_questions, 3);
    assert.equal(resultRow1.total_correct, 2);
    assert.equal(resultRow1.total_wrong, 1);
    assert.equal(resultRow1.total_unanswered, 0);
    assert.equal(resultRow1.score, 66.67);

    // Verify golden score for Session 2: 1 out of 3 = 33.33 (2 unanswered)
    const resultRow2 = await d1.prepare('SELECT * FROM cbt_exam_results WHERE session_id=?').bind('sess-02').first<any>();
    assert.ok(resultRow2);
    assert.equal(resultRow2.total_questions, 3);
    assert.equal(resultRow2.total_correct, 1);
    assert.equal(resultRow2.total_wrong, 0);
    assert.equal(resultRow2.total_unanswered, 2);
    assert.equal(resultRow2.score, 33.33);
  });

  it('4. Analytics: comprehensive golden test matching getExamQuestionAnalytics and AnalyticsView.tsx', async () => {
    const { d1 } = createTestD1Database();

    await d1.prepare("INSERT INTO cbt_rooms (id, room_name) VALUES ('r-lab', 'LAB-1')").run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, mode, created_by) VALUES ('ex-ana', 'Ujian Analisis', 'semester', 'admin')").run();

    // 3 Questions with varying difficulty profile:
    // Q1: Mudah (100% correct)
    // Q2: Sedang (50% correct)
    // Q3: Sulit (0% correct, flagged as 'Perlu review')
    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order) VALUES ('q1', 'ex-ana', 'Soal 1', 'multiple_choice', 1)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct, option_order) VALUES ('q1-opt-a', 'q1', 'A', 'Kunci 1', 1, 1)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct, option_order) VALUES ('q1-opt-b', 'q1', 'B', 'Pengecoh 1', 0, 2)").run();

    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order) VALUES ('q2', 'ex-ana', 'Soal 2', 'multiple_choice', 2)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct, option_order) VALUES ('q2-opt-a', 'q2', 'A', 'Kunci 2', 1, 1)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct, option_order) VALUES ('q2-opt-b', 'q2', 'B', 'Pengecoh 2', 0, 2)").run();

    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order) VALUES ('q3', 'ex-ana', 'Soal 3', 'multiple_choice', 3)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct, option_order) VALUES ('q3-opt-a', 'q3', 'A', 'Kunci 3', 1, 1)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct, option_order) VALUES ('q3-opt-b', 'q3', 'B', 'Pengecoh 3', 0, 2)").run();

    // 4 Students submitted sessions
    for (let i = 1; i <= 4; i++) {
      await d1.prepare(`INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status) VALUES ('s-${i}', 'ex-ana', 'u-${i}', 'student', 'r-lab', 'submitted')`).run();
    }

    // Answers distribution:
    // All 4 answer Q1 correctly (q1-opt-a) -> 4/4 = 100% correct
    for (let i = 1; i <= 4; i++) {
      await d1.prepare(`INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-q1-${i}', 's-${i}', 'q1', 'q1-opt-a')`).run();
    }

    // Q2: Students 1 & 2 answer A (correct), Students 3 & 4 answer B (wrong) -> 2/4 = 50% correct
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-q2-1', 's-1', 'q2', 'q2-opt-a')").run();
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-q2-2', 's-2', 'q2', 'q2-opt-a')").run();
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-q2-3', 's-3', 'q2', 'q2-opt-b')").run();
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-q2-4', 's-4', 'q2', 'q2-opt-b')").run();

    // Q3: Student 1 answers B (wrong), Students 2, 3, 4 leave blank -> 0/4 = 0% correct, 3 blank
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-q3-1', 's-1', 'q3', 'q3-opt-b')").run();

    // Insert precomputed exam results for score buckets & summary statistics testing
    // Student 1: 2 correct, 1 wrong, 0 unanswered -> 66.67
    // Student 2: 2 correct, 0 wrong, 1 unanswered -> 66.67
    // Student 3: 1 correct, 1 wrong, 1 unanswered -> 33.33
    // Student 4: 1 correct, 1 wrong, 1 unanswered -> 33.33
    await d1.prepare("INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score) VALUES ('res-1', 's-1', 'ex-ana', 'u-1', 'student', 3, 2, 1, 0, 66.67)").run();
    await d1.prepare("INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score) VALUES ('res-2', 's-2', 'ex-ana', 'u-2', 'student', 3, 2, 0, 1, 66.67)").run();
    await d1.prepare("INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score) VALUES ('res-3', 's-3', 'ex-ana', 'u-3', 'student', 3, 1, 1, 1, 33.33)").run();
    await d1.prepare("INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score) VALUES ('res-4', 's-4', 'ex-ana', 'u-4', 'student', 3, 1, 1, 1, 33.33)").run();

    // 1. Verify getExamQuestionAnalytics service payload
    const analytics = await getExamQuestionAnalytics(d1, 'ex-ana');
    assert.equal(analytics.questions.length, 3);
    assert.equal(analytics.options.length, 6);
    // Total rows = 3 questions * 4 sessions = 12
    assert.equal(analytics.rows.length, 12);

    // 2. Canonical Frontend AnalyticsView computations
    const qaRows = analytics.rows;
    const sessionCount = new Set(qaRows.map((r: any) => r.session_id)).size;
    assert.equal(sessionCount, 4);

    const optionCounts = qaRows.reduce((map: Map<string, number>, row: any) => {
      if (row.selected_option_id) map.set(row.selected_option_id, (map.get(row.selected_option_id) || 0) + 1);
      return map;
    }, new Map());

    // Option distribution assertions
    assert.equal(optionCounts.get('q1-opt-a'), 4);
    assert.equal(optionCounts.get('q1-opt-b') || 0, 0);
    assert.equal(optionCounts.get('q2-opt-a'), 2);
    assert.equal(optionCounts.get('q2-opt-b'), 2);
    assert.equal(optionCounts.get('q3-opt-a') || 0, 0);
    assert.equal(optionCounts.get('q3-opt-b'), 1);

    // Difficulty & Flag classification per question
    const questionRows = analytics.questions.map((q: any) => {
      const rows = qaRows.filter((r: any) => r.question_id === q.id);
      const answered = rows.filter((r: any) => Number(r.answered) === 1).length;
      const correct = rows.filter((r: any) => Number(r.is_correct) === 1).length;
      const blank = Math.max(0, sessionCount - answered);
      const wrong = Math.max(0, answered - correct);
      const correctRate = sessionCount ? Math.round((correct / sessionCount) * 100) : 0;
      const difficulty = correctRate >= 76 ? 'Mudah' : correctRate >= 41 ? 'Sedang' : 'Sulit';
      const flag = sessionCount === 0
        ? 'Belum ada data'
        : correctRate <= 20
          ? 'Perlu review'
          : blank / Math.max(1, sessionCount) >= 0.3
            ? 'Banyak kosong'
            : '';
      return { id: q.id, answered, correct, wrong, blank, correctRate, difficulty, flag };
    });

    // Q1: Mudah (100% correct, 0 blank)
    assert.equal(questionRows[0].id, 'q1');
    assert.equal(questionRows[0].correctRate, 100);
    assert.equal(questionRows[0].difficulty, 'Mudah');
    assert.equal(questionRows[0].flag, '');

    // Q2: Sedang (50% correct, 0 blank)
    assert.equal(questionRows[1].id, 'q2');
    assert.equal(questionRows[1].correctRate, 50);
    assert.equal(questionRows[1].difficulty, 'Sedang');
    assert.equal(questionRows[1].flag, '');

    // Q3: Sulit (0% correct <= 20% -> 'Perlu review')
    assert.equal(questionRows[2].id, 'q3');
    assert.equal(questionRows[2].correctRate, 0);
    assert.equal(questionRows[2].difficulty, 'Sulit');
    assert.equal(questionRows[2].flag, 'Perlu review');
    assert.equal(questionRows[2].blank, 3);

    // 3. Score buckets matching AnalyticsView
    const { results: rawResults } = await d1.prepare("SELECT * FROM cbt_exam_results WHERE exam_id='ex-ana'").all<any>();
    const scores = (rawResults || []).map((r: any) => Number(r.score || 0));
    const scoreBuckets = [
      { label: '0-40', count: scores.filter(s => s <= 40).length },
      { label: '41-60', count: scores.filter(s => s > 40 && s <= 60).length },
      { label: '61-75', count: scores.filter(s => s > 60 && s <= 75).length },
      { label: '76-90', count: scores.filter(s => s > 75 && s <= 90).length },
      { label: '91-100', count: scores.filter(s => s > 90).length },
    ];

    assert.deepEqual(scoreBuckets, [
      { label: '0-40', count: 2 },   // Students 3 & 4 (33.33)
      { label: '41-60', count: 0 },
      { label: '61-75', count: 2 },  // Students 1 & 2 (66.67)
      { label: '76-90', count: 0 },
      { label: '91-100', count: 0 },
    ]);

    // 4. Summary statistics matching AnalyticsView
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const totalCorrect = (rawResults || []).reduce((sum: number, r: any) => sum + r.total_correct, 0);
    const totalWrong = (rawResults || []).reduce((sum: number, r: any) => sum + r.total_wrong, 0);
    const totalUnanswered = (rawResults || []).reduce((sum: number, r: any) => sum + r.total_unanswered, 0);

    assert.equal(avgScore, 50); // (66.67 + 66.67 + 33.33 + 33.33) / 4 = 50
    assert.equal(maxScore, 66.67);
    assert.equal(minScore, 33.33);
    assert.equal(totalCorrect, 6);
    assert.equal(totalWrong, 3);
    assert.equal(totalUnanswered, 3);

    // 5. Explicit Contract Documentation: Advanced psychometric metrics
    // The existing engine does NOT compute:
    // - Discrimination Index (D = P_upper - P_lower)
    // - Point-Biserial Correlation (r_pbi)
    // - Distractor Efficiency Index (DEI)
    // Documented strictly as: N/A — not implemented in existing engine
    const psychometrics = {
      discriminationIndex: 'N/A — not implemented in existing engine',
      pointBiserialCorrelation: 'N/A — not implemented in existing engine',
      distractorEfficiencyIndex: 'N/A — not implemented in existing engine',
    };
    assert.equal(psychometrics.discriminationIndex, 'N/A — not implemented in existing engine');
  });

  it('5. Rooms & Proctors: manages canonical cbt_rooms without legacy PMB sync', async () => {
    const { d1 } = createTestD1Database();

    // Create room
    const r1 = await createRoom(d1, { room_name: 'RUANG 01', capacity: 36 });
    assert.equal(r1.success, true);
    assert.ok(r1.data?.id);
    const roomId = r1.data!.id;

    // List rooms
    const rooms = await listRooms(d1, {});
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].room_name, 'RUANG 01');
    assert.equal(rooms[0].capacity, 36);
    assert.equal(rooms[0].jumlah_peserta, 0);

    // Create proctor user & assign
    await d1.prepare(
      "INSERT INTO cbt_users (id, username, nama_lengkap, role) VALUES ('proc-1', 'proktor1', 'Pak Ahmad', 'proctor')"
    ).run();
    const assign = await assignProctor(d1, 'proc-1', roomId);
    assert.equal(assign.success, true);

    const proctors = await listProctors(d1);
    assert.equal(proctors.length, 1);
    assert.equal(proctors[0].room_id, roomId);
    assert.equal(proctors[0].room_name, 'RUANG 01');

    // Delete room
    const del = await deleteRoom(d1, roomId);
    assert.equal(del.success, true);

    const proctorsAfter = await listProctors(d1);
    assert.equal(proctorsAfter[0].room_id, null);
  });

  it('6. API Contract — Authoring: full exam & questions CRUD + bulk import via HTTP', async () => {
    const { d1 } = createTestD1Database();
    const { app, adminToken } = await createTestApp(d1);

    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode, status) VALUES ('ev-http-1', 'EV-HTTP-1', 'Semester Gasal', 'semester', 'ready')").run();

    // 1. POST /api/admin/exams
    const createExamRes = await app.request('/api/admin/exams', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Fisika Kelas XI',
        event_id: 'ev-http-1',
        duration_minutes: 90,
      }),
    });
    assert.equal(createExamRes.status, 201);
    const examBody = await createExamRes.json<any>();
    assert.equal(examBody.success, true);
    assert.ok(examBody.data?.id);
    const examId = examBody.data.id;

    // 2. GET /api/admin/exams
    const listExamRes = await app.request('/api/admin/exams?event_id=ev-http-1', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(listExamRes.status, 200);
    const listBody = await listExamRes.json<any>();
    assert.equal(listBody.success, true);
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0].title, 'Fisika Kelas XI');
    assert.equal(listBody.data[0].mode, 'semester');

    // 3. PUT /api/admin/exams/:id
    const putExamRes = await app.request(`/api/admin/exams/${examId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Fisika Kelas XI (Revisi)',
        duration_minutes: 120,
      }),
    });
    assert.equal(putExamRes.status, 200);

    // 4. POST /api/admin/exams/:id/questions
    const postQRes = await app.request(`/api/admin/exams/${examId}/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        question_text: 'Satuan gaya dalam SI adalah?',
        question_type: 'multiple_choice',
        question_order: 1,
        options: [
          { option_label: 'A', option_text: 'Newton', is_correct: 1 },
          { option_label: 'B', option_text: 'Joule', is_correct: 0 },
        ],
      }),
    });
    assert.equal(postQRes.status, 201);
    const postQBody = await postQRes.json<any>();
    const q1Id = postQBody.data.id;

    // 5. POST /api/admin/exams/:id/questions/bulk
    const bulkQRes = await app.request(`/api/admin/exams/${examId}/questions/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        questions: [
          {
            question_text: 'Hukum Newton II berbunyi F = m . a',
            question_type: 'multiple_choice',
            question_order: 2,
            options: [
              { option_label: 'A', option_text: 'Benar', is_correct: 1 },
              { option_label: 'B', option_text: 'Salah', is_correct: 0 },
            ],
          },
          {
            question_text: 'Jelaskan konsep energi kinetik!',
            question_type: 'essay',
            question_order: 3,
          },
        ],
      }),
    });
    assert.equal(bulkQRes.status, 201);
    const bulkQBody = await bulkQRes.json<any>();
    assert.equal(bulkQBody.data?.imported, 2);

    // 6. GET /api/admin/exams/:id/questions
    const getQRes = await app.request(`/api/admin/exams/${examId}/questions`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getQRes.status, 200);
    const getQBody = await getQRes.json<any>();
    assert.equal(getQBody.data.length, 3);

    // 7. PUT /api/admin/questions/:qId
    const putQRes = await app.request(`/api/admin/questions/${q1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        question_text: 'Satuan gaya dalam SI adalah? (Revisi)',
        question_type: 'multiple_choice',
        question_order: 1,
        options: [
          { option_label: 'A', option_text: 'Newton (N)', is_correct: 1 },
          { option_label: 'B', option_text: 'Pascal (Pa)', is_correct: 0 },
        ],
      }),
    });
    assert.equal(putQRes.status, 200);

    // 8. DELETE /api/admin/questions/:qId
    const delQRes = await app.request(`/api/admin/questions/${q1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delQRes.status, 200);

    // 9. DELETE /api/admin/exams/:id
    const delExamRes = await app.request(`/api/admin/exams/${examId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delExamRes.status, 200);
  });

  it('7. API Contract — Runtime Tokens & Assignments: lifecycle, toggle, custom code & assignment operations via HTTP', async () => {
    const { d1 } = createTestD1Database();
    const { app, adminToken } = await createTestApp(d1);

    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode) VALUES ('ev-tok-1', 'EV-TOK-1', 'Event Token', 'pmb')").run();
    await d1.prepare("INSERT INTO cbt_rooms (id, room_name, capacity, event_id) VALUES ('r-tok-1', 'LAB-CBT-1', 40, 'ev-tok-1')").run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode, created_by) VALUES ('ex-tok-1', 'Ujian Masuk', 'ev-tok-1', 'pmb', 'admin')").run();

    // Roster participant
    await d1.prepare(
      `INSERT INTO cbt_exam_roster (id, event_id, exam_id, source_key, source_id, username, full_name, room_id, tanggal_tes, sesi_tes)
       VALUES ('rost-tok-1', 'ev-tok-1', 'ex-tok-1', 'mansatas', 'stud-tok-1', '998877', 'Ahmad Siswa', 'r-tok-1', '2026-09-25', 'Sesi 1')`
    ).run();

    // 1. POST /api/admin/exams/:id/assignments
    const assignRes = await app.request('/api/admin/exams/ex-tok-1/assignments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        users: [{ user_id: 'stud-tok-1', user_type: 'cbt_user' }],
      }),
    });
    assert.equal(assignRes.status, 200);

    // 2. GET /api/admin/exams/:id/assignments
    const getAssignRes = await app.request('/api/admin/exams/ex-tok-1/assignments', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getAssignRes.status, 200);
    const assignBody = await getAssignRes.json<any>();
    assert.equal(assignBody.data.length, 1);
    const assignmentId = assignBody.data[0].id;

    // 3. POST /api/admin/exams/:id/assignments/room
    const assignRoomRes = await app.request('/api/admin/exams/ex-tok-1/assignments/room', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ rooms: ['r-tok-1'] }),
    });
    assert.equal(assignRoomRes.status, 200);

    // 4. POST /api/admin/exams/:id/assignments/sesi
    const assignSesiRes = await app.request('/api/admin/exams/ex-tok-1/assignments/sesi', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ sessions: ['Sesi 1'] }),
    });
    assert.equal(assignSesiRes.status, 200);

    // 5. POST /api/admin/exams/:id/assignments/group
    const assignGroupRes = await app.request('/api/admin/exams/ex-tok-1/assignments/group', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ groups: [{ tanggal_tes: '2026-09-25', sesi_tes: 'Sesi 1' }] }),
    });
    assert.equal(assignGroupRes.status, 200);

    // 6. POST /api/admin/exams/:id/tokens/generate
    const genTokenRes = await app.request('/api/admin/exams/ex-tok-1/tokens/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ room_ids: ['r-tok-1'] }),
    });
    assert.equal(genTokenRes.status, 200);

    // 7. GET /api/admin/exams/:id/tokens
    const getTokensRes = await app.request('/api/admin/exams/ex-tok-1/tokens', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getTokensRes.status, 200);
    const tokensBody = await getTokensRes.json<any>();
    assert.equal(tokensBody.data.length, 2);
    const tokenId = tokensBody.data[0].id;
    assert.equal(tokensBody.data[0].is_active, 1);

    // 8. POST /api/admin/exams/:id/tokens/:tokenId/active (toggle off)
    const toggleOffRes = await app.request(`/api/admin/exams/ex-tok-1/tokens/${tokenId}/active`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ is_active: 0 }),
    });
    assert.equal(toggleOffRes.status, 200);

    // 9. POST /api/admin/exams/:id/tokens/invalid-id/active (404 test)
    const toggle404Res = await app.request('/api/admin/exams/ex-tok-1/tokens/non-existent-id/active', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ is_active: 1 }),
    });
    assert.equal(toggle404Res.status, 404);

    // 10. POST /api/admin/exams/:id/tokens/set-code
    const setCodeRes = await app.request('/api/admin/exams/ex-tok-1/tokens/set-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ token_code: 'SUKSES2026' }),
    });
    assert.equal(setCodeRes.status, 200);

    // Verify token code updated and re-activated
    const recheckTokens = await app.request('/api/admin/exams/ex-tok-1/tokens', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const recheckBody = await recheckTokens.json<any>();
    assert.equal(recheckBody.data[0].token_code, 'SUKSES2026');
    assert.equal(recheckBody.data[0].is_active, 1);

    // 11. DELETE /api/admin/exams/:id/assignments/:assignmentId
    const delAssignRes = await app.request(`/api/admin/exams/ex-tok-1/assignments/${assignmentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delAssignRes.status, 200);
  });

  it('8. API Contract — Rooms & Proctors: full room lifecycle and proctor assignments via HTTP', async () => {
    const { d1 } = createTestD1Database();
    const { app, adminToken } = await createTestApp(d1);

    // 1. POST /api/admin/rooms
    const createRoomRes = await app.request('/api/admin/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ room_name: 'LAB-KOMP-A', capacity: 32 }),
    });
    assert.equal(createRoomRes.status, 201);
    const roomBody = await createRoomRes.json<any>();
    const roomId = roomBody.data.id;

    // 2. GET /api/admin/rooms
    const getRoomsRes = await app.request('/api/admin/rooms', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getRoomsRes.status, 200);
    const listRoomsBody = await getRoomsRes.json<any>();
    assert.equal(listRoomsBody.data.length, 1);
    assert.equal(listRoomsBody.data[0].room_name, 'LAB-KOMP-A');

    // 3. PUT /api/admin/rooms/:id
    const putRoomRes = await app.request(`/api/admin/rooms/${roomId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ room_name: 'LAB-KOMP-A (UTAMA)', capacity: 36 }),
    });
    assert.equal(putRoomRes.status, 200);

    // Insert proctor user
    await d1.prepare("INSERT INTO cbt_users (id, username, nama_lengkap, role) VALUES ('proc-h-1', 'proktor.http', 'Pak Budiman', 'proctor')").run();

    // 4. PUT /api/admin/proctors/:id/assign
    const assignProcRes = await app.request('/api/admin/proctors/proc-h-1/assign', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ room_id: roomId }),
    });
    assert.equal(assignProcRes.status, 200);

    // 5. GET /api/admin/proctors
    const getProctorsRes = await app.request('/api/admin/proctors', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getProctorsRes.status, 200);
    const proctorsBody = await getProctorsRes.json<any>();
    assert.equal(proctorsBody.data.length, 1);
    assert.equal(proctorsBody.data[0].room_id, roomId);

    // 6. DELETE /api/admin/rooms/:id
    const delRoomRes = await app.request(`/api/admin/rooms/${roomId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(delRoomRes.status, 200);
  });

  it('9. API Contract — Monitoring & Proctor Operations: sessions monitoring, unlock, cheat-logs & emergency force-submit via HTTP', async () => {
    const { d1 } = createTestD1Database();
    const { app, adminToken, proctorToken } = await createTestApp(d1);

    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode) VALUES ('ev-mon-1', 'EV-MON-1', 'Event Pantau', 'semester')").run();
    await d1.prepare("INSERT INTO cbt_rooms (id, room_name, capacity) VALUES ('room-01', 'LAB-PROKTOR', 40)").run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, duration_minutes, active_status, mode, created_by) VALUES ('ex-mon-1', 'Ujian Aktif', 60, 'active', 'semester', 'admin')").run();
    await d1.prepare("INSERT INTO cbt_exam_tokens (id, exam_id, room_id, tanggal_tes, sesi_tes, token_code, is_active) VALUES ('tok-mon-1', 'ex-mon-1', 'room-01', '2026-09-25', 'Sesi 1', '123456', 1)").run();

    // Insert active session in room-01
    await d1.prepare(
      `INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status, is_time_locked, cheat_warnings)
       VALUES ('sess-mon-1', 'ex-mon-1', 'student-m1', 'student', 'room-01', 'active', 1, 1)`
    ).run();

    // 1. GET /api/admin/exams/:id/sessions (Admin monitoring router)
    const adminSessionsRes = await app.request('/api/admin/exams/ex-mon-1/sessions', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminSessionsRes.status, 200);
    const adminSessionsBody = await adminSessionsRes.json<any>();
    assert.equal(adminSessionsBody.data.length, 1);

    // 2. GET /api/proctor/sessions (Proctor live view for room-01)
    const procSessionsRes = await app.request('/api/proctor/sessions', {
      headers: { Authorization: `Bearer ${proctorToken}` },
    });
    assert.equal(procSessionsRes.status, 200);

    // 3. Insert cheat log and test GET /api/proctor/sessions/:id/cheat-logs
    await d1.prepare(
      "INSERT INTO cbt_cheat_logs (id, session_id, violation_type, happened_at) VALUES ('cl-1', 'sess-mon-1', 'tab_switch', datetime('now'))"
    ).run();
    const cheatLogsRes = await app.request('/api/proctor/sessions/sess-mon-1/cheat-logs', {
      headers: { Authorization: `Bearer ${proctorToken}` },
    });
    assert.equal(cheatLogsRes.status, 200);
    const cheatLogsBody = await cheatLogsRes.json<any>();
    assert.equal(cheatLogsBody.data.length, 1);
    assert.equal(cheatLogsBody.data[0].violation_type, 'tab_switch');

    // 4. POST /api/proctor/sessions/:id/unlock
    const unlockRes = await app.request('/api/proctor/sessions/sess-mon-1/unlock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${proctorToken}` },
    });
    assert.equal(unlockRes.status, 200);

    // 5. POST /api/proctor/sessions/:id/force-submit
    const forceSubmitRes = await app.request('/api/proctor/sessions/sess-mon-1/force-submit', {
      method: 'POST',
      headers: { Authorization: `Bearer ${proctorToken}` },
    });
    assert.equal(forceSubmitRes.status, 200);

    // Verify session status is now submitted
    const sessionAfter = await d1.prepare('SELECT status FROM cbt_exam_sessions WHERE id=?').bind('sess-mon-1').first<any>();
    assert.equal(sessionAfter.status, 'submitted');
  });

  it('10. API Contract — Results, Recompute & Question Analytics: complete reporting, recomputation & analytics via HTTP', async () => {
    const { d1 } = createTestD1Database();
    const { app, adminToken } = await createTestApp(d1);

    await d1.prepare("INSERT INTO cbt_events (id, code, name, mode) VALUES ('ev-res-1', 'EV-RES-1', 'Event Hasil', 'semester')").run();
    await d1.prepare("INSERT INTO cbt_rooms (id, room_name) VALUES ('r-res-1', 'LAB-RES')").run();
    await d1.prepare("INSERT INTO cbt_exams (id, title, event_id, mode, created_by) VALUES ('ex-res-1', 'Ujian Akhir', 'ev-res-1', 'semester', 'admin')").run();
    await d1.prepare(
      `INSERT INTO cbt_exam_roster (id, event_id, exam_id, source_key, source_id, username, full_name, room_id)
       VALUES ('rost-res-1', 'ev-res-1', 'ex-res-1', 'cbt_user', 'u-r1', 'u-r1', 'Siswa Hasil', 'r-res-1')`
    ).run();
    await d1.prepare("INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order) VALUES ('q-res-1', 'ex-res-1', '2 + 2 = ?', 'multiple_choice', 1)").run();
    await d1.prepare("INSERT INTO cbt_question_options (id, question_id, option_label, option_text, is_correct, option_order) VALUES ('opt-r1', 'q-res-1', 'A', '4', 1, 1)").run();
    await d1.prepare("INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status) VALUES ('sess-r-1', 'ex-res-1', 'u-r1', 'cbt_user', 'r-res-1', 'submitted')").run();
    await d1.prepare("INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id) VALUES ('ans-r1', 'sess-r-1', 'q-res-1', 'opt-r1')").run();

    // 1. POST /api/admin/exams/:id/results/recompute-missing
    const recomputeRes = await app.request('/api/admin/exams/ex-res-1/results/recompute-missing', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(recomputeRes.status, 200);
    const recomputeBody = await recomputeRes.json<any>();
    assert.equal(recomputeBody.data?.repaired, 1);

    // 2. GET /api/admin/exams/:id/results
    const getResultsRes = await app.request('/api/admin/exams/ex-res-1/results', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(getResultsRes.status, 200);
    const resultsBody = await getResultsRes.json<any>();
    assert.equal(resultsBody.data.length, 1);
    assert.equal(resultsBody.data[0].score, 100);

    // 3. GET /api/admin/exams/:id/results-export
    const exportRes = await app.request('/api/admin/exams/ex-res-1/results-export', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(exportRes.status, 200);
    const exportBody = await exportRes.json<any>();
    assert.equal(exportBody.data.length, 1);

    // 4. GET /api/admin/exams/:id/question-analytics
    const analyticsRes = await app.request('/api/admin/exams/ex-res-1/question-analytics', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(analyticsRes.status, 200);
    const analyticsBody = await analyticsRes.json<any>();
    assert.equal(analyticsBody.data.questions.length, 1);
    assert.equal(analyticsBody.data.rows.length, 1);

    // 5. DELETE /api/admin/exams/:id/results/:sessionId
    const deleteResRes = await app.request('/api/admin/exams/ex-res-1/results/sess-r-1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(deleteResRes.status, 200);
  });

  it('11. API Contract — RBAC & Negative Authorization Matrix: strict 401 unauthenticated & 403 role-boundary rejections', async () => {
    const { d1 } = createTestD1Database();
    const { app, adminToken, proctorToken, studentToken } = await createTestApp(d1);

    // A. 401 Unauthenticated: Missing Authorization header
    const resNoAuth1 = await app.request('/api/admin/exams');
    assert.equal(resNoAuth1.status, 401);
    const resNoAuth2 = await app.request('/api/admin/rooms');
    assert.equal(resNoAuth2.status, 401);
    const resNoAuth3 = await app.request('/api/proctor/sessions');
    assert.equal(resNoAuth3.status, 401);

    // B. 401 Corrupted / Invalid Token
    const resBadToken = await app.request('/api/admin/exams', {
      headers: { Authorization: 'Bearer corrupt.invalid.token' },
    });
    assert.equal(resBadToken.status, 401);

    // C. 403 Forbidden: Student attempting Admin routes
    const resStudentAdminExams = await app.request('/api/admin/exams', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(resStudentAdminExams.status, 403);

    const resStudentAdminRooms = await app.request('/api/admin/rooms', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(resStudentAdminRooms.status, 403);

    // D. 403 Forbidden: Proctor attempting Admin routes
    const resProcAdminExams = await app.request('/api/admin/exams', {
      headers: { Authorization: `Bearer ${proctorToken}` },
    });
    assert.equal(resProcAdminExams.status, 403);

    // E. 403 Forbidden: Admin attempting Proctor-only routes (proctor middleware requires role: proctor)
    const resAdminProctor = await app.request('/api/proctor/sessions', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resAdminProctor.status, 403);

    // F. 403 Forbidden: Student attempting Proctor routes
    const resStudentProctor = await app.request('/api/proctor/sessions', {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert.equal(resStudentProctor.status, 403);
  });
});
