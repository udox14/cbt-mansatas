// ============================================================
// Student Routes — supports pendaftar PMB & cbt_users
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { buildRandomMaps, newId, ok, err, now } from '../utils/helpers';

const student = new Hono<{ Bindings: Env }>();
student.use('*', authMiddleware, requireRole('student'));

// GET daftar ujian aktif
student.get('/exams', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.description, e.duration_minutes, e.rules_text, e.active_status,
            es.id as session_id, es.status as session_status
     FROM cbt_exams e
     LEFT JOIN cbt_exam_sessions es ON es.exam_id = e.id AND es.user_id = ? AND es.user_type = ?
     WHERE e.active_status = 'active'
     ORDER BY e.title`
  ).bind(user.sub, user.source === 'pendaftar' ? 'pendaftar' : 'cbt_user').all();
  return c.json(ok(results));
});

// POST validasi token & mulai ujian
student.post('/exams/:examId/validate-token', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user');
  const { token_code, device_id } = await c.req.json<{ token_code: string; device_id: string }>();
  const userType = user.source === 'pendaftar' ? 'pendaftar' : 'cbt_user';

  if (!user.room_id) return c.json(err('Anda belum di-assign ke ruangan'), 400);
  if (!token_code) return c.json(err('Token wajib diisi'), 400);
  if (!device_id) return c.json(err('Device ID diperlukan'), 400);

  // Validasi token
  const tokenRow = await c.env.DB.prepare(
    `SELECT * FROM cbt_exam_tokens WHERE exam_id=? AND room_id=? AND token_code=? AND is_active=1`
  ).bind(examId, user.room_id, token_code).first();
  if (!tokenRow) return c.json(err('Token tidak valid atau sudah kedaluwarsa'), 401);

  // Cek ujian aktif
  const exam = await c.env.DB.prepare(`SELECT * FROM cbt_exams WHERE id=? AND active_status='active'`).bind(examId).first<any>();
  if (!exam) return c.json(err('Ujian tidak tersedia'), 404);

  // Cek sesi existing
  const existing = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE exam_id=? AND user_id=? AND user_type=?'
  ).bind(examId, user.sub, userType).first<any>();

  if (existing) {
    if (existing.status === 'submitted' || existing.status === 'force_submitted')
      return c.json(err('Anda sudah menyelesaikan ujian ini'), 400);
    if (existing.device_id && existing.device_id !== device_id)
      return c.json(err('Sesi terkunci di perangkat lain. Hubungi pengawas untuk reset.'), 403);
    await c.env.DB.prepare('UPDATE cbt_exam_sessions SET device_id=?, last_heartbeat=? WHERE id=?')
      .bind(device_id, now(), existing.id).run();
    return c.json(ok({
      session_id: existing.id, resumed: true,
      question_map: JSON.parse(existing.question_map || '[]'),
      option_map: JSON.parse(existing.option_map || '{}'),
      started_at: existing.started_at, duration_minutes: exam.duration_minutes,
    }, 'Sesi dilanjutkan'));
  }

  // Buat sesi baru + randomize
  const { results: questions } = await c.env.DB.prepare(
    'SELECT id FROM cbt_questions WHERE exam_id=? ORDER BY question_order'
  ).bind(examId).all();
  const qIds = (questions as any[]).map(q => q.id);
  const { results: allOpts } = await c.env.DB.prepare(
    `SELECT qo.id, qo.question_id FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id WHERE q.exam_id=? ORDER BY qo.option_order`
  ).bind(examId).all();
  const optsByQ: Record<string, { id: string }[]> = {};
  for (const o of allOpts as any[]) { if (!optsByQ[o.question_id]) optsByQ[o.question_id] = []; optsByQ[o.question_id].push({ id: o.id }); }
  const qData = qIds.map(id => ({ id, options: optsByQ[id] || [] }));
  const { questionMap, optionMap } = buildRandomMaps(qData, !!exam.randomize_questions, !!exam.randomize_options);

  const sessionId = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, device_id, question_map, option_map, ip_address, user_agent)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(sessionId, examId, user.sub, userType, user.room_id, device_id,
    JSON.stringify(questionMap), JSON.stringify(optionMap),
    c.req.header('CF-Connecting-IP') || '', c.req.header('User-Agent') || ''
  ).run();

  return c.json(ok({
    session_id: sessionId, resumed: false,
    question_map: questionMap, option_map: optionMap,
    started_at: now(), duration_minutes: exam.duration_minutes,
  }, 'Ujian dimulai'), 201);
});

// GET soal ujian
student.get('/sessions/:sessionId/questions', async (c) => {
  const user = c.get('user');
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?'
  ).bind(c.req.param('sessionId'), user.sub).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);
  if (session.status === 'submitted' || session.status === 'force_submitted')
    return c.json(err('Ujian sudah selesai'), 400);

  const qMap: string[] = JSON.parse(session.question_map || '[]');
  const oMap: Record<string, string[]> = JSON.parse(session.option_map || '{}');

  const { results: questions } = await c.env.DB.prepare(
    'SELECT id, question_text, question_type, image_url, audio_url, points FROM cbt_questions WHERE exam_id=?'
  ).bind(session.exam_id).all();
  const qById = new Map((questions as any[]).map(q => [q.id, q]));

  const qIds = questions.map((q: any) => q.id);
  const ph = qIds.map(() => '?').join(',');
  const { results: options } = await c.env.DB.prepare(
    `SELECT id, question_id, option_label, option_text, image_url FROM cbt_question_options WHERE question_id IN (${ph})`
  ).bind(...qIds).all();
  const oByQ = new Map<string, any[]>();
  for (const o of options as any[]) { if (!oByQ.has(o.question_id)) oByQ.set(o.question_id, []); oByQ.get(o.question_id)!.push(o); }

  const ordered = qMap.map((qId, idx) => {
    const q = qById.get(qId)!;
    const oIds = oMap[qId] || [];
    const oAll = oByQ.get(qId) || [];
    const oById = new Map(oAll.map((o: any) => [o.id, o]));
    const orderedOpts = oIds.length > 0 ? oIds.map(id => oById.get(id)).filter(Boolean) : oAll;
    return { index: idx, id: q.id, question_text: q.question_text, question_type: q.question_type,
      image_url: q.image_url, audio_url: q.audio_url, options: orderedOpts };
  });

  const { results: answers } = await c.env.DB.prepare(
    'SELECT question_id, selected_option_id, essay_answer, is_doubtful FROM cbt_student_answers WHERE session_id=?'
  ).bind(c.req.param('sessionId')).all();

  return c.json(ok({ questions: ordered, answers }));
});

// POST batch save jawaban
student.post('/sessions/:sessionId/answers', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const { answers } = await c.req.json<{ answers: any[] }>();

  const session = await c.env.DB.prepare(
    'SELECT id, status FROM cbt_exam_sessions WHERE id=? AND user_id=?'
  ).bind(sessionId, user.sub).first<any>();
  if (!session || session.status === 'submitted' || session.status === 'force_submitted')
    return c.json(err('Sesi tidak aktif'), 400);
  if (!answers?.length) return c.json(ok(null));

  const stmts = answers.map((a: any) =>
    c.env.DB.prepare(
      `INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id, essay_answer, is_doubtful, answered_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(session_id, question_id) DO UPDATE SET
       selected_option_id=excluded.selected_option_id, essay_answer=excluded.essay_answer,
       is_doubtful=excluded.is_doubtful, answered_at=excluded.answered_at`
    ).bind(newId(), sessionId, a.question_id, a.selected_option_id || null, a.essay_answer || null, a.is_doubtful ? 1 : 0, now())
  );
  for (let i = 0; i < stmts.length; i += 100) { await c.env.DB.batch(stmts.slice(i, i + 100)); }
  await c.env.DB.prepare('UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=?').bind(now(), sessionId).run();
  return c.json(ok(null, 'Jawaban tersimpan'));
});

// POST heartbeat
student.post('/sessions/:sessionId/heartbeat', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=? AND user_id=?')
    .bind(now(), c.req.param('sessionId'), user.sub).run();
  return c.json(ok(null));
});

// POST cheat
student.post('/sessions/:sessionId/cheat', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?'
  ).bind(sessionId, user.sub).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);

  const newW = (session.cheat_warnings || 0) + 1;
  const autoSubmit = newW >= 3;
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET cheat_warnings=?, status=?, ${autoSubmit ? 'finished_at=?,' : ''} last_heartbeat=? WHERE id=?`
  ).bind(newW, autoSubmit ? 'force_submitted' : 'active', ...(autoSubmit ? [now()] : []), now(), sessionId).run();

  if (autoSubmit) await computeScore(c.env.DB, sessionId, session.exam_id, session.user_id, session.user_type);
  return c.json(ok({ warnings: newW, auto_submitted: autoSubmit }));
});

// POST submit
student.post('/sessions/:sessionId/submit', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?'
  ).bind(sessionId, user.sub).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);
  if (session.status === 'submitted' || session.status === 'force_submitted')
    return c.json(err('Ujian sudah diselesaikan'), 400);

  await c.env.DB.prepare(`UPDATE cbt_exam_sessions SET status='submitted', finished_at=? WHERE id=?`)
    .bind(now(), sessionId).run();
  const result = await computeScore(c.env.DB, sessionId, session.exam_id, session.user_id, session.user_type);

  const exam = await c.env.DB.prepare('SELECT completion_message, is_score_visible FROM cbt_exams WHERE id=?')
    .bind(session.exam_id).first<any>();
  return c.json(ok({
    completion_message: exam?.completion_message || 'Ujian selesai.',
    score_visible: !!exam?.is_score_visible,
    ...(exam?.is_score_visible ? result : {}),
  }, 'Ujian berhasil diselesaikan'));
});

// ── COMPUTE SCORE ─────────────────────────────────────────────
async function computeScore(db: D1Database, sessionId: string, examId: string, userId: string, userType: string) {
  const { results: answers } = await db.prepare(
    'SELECT question_id, selected_option_id FROM cbt_student_answers WHERE session_id=?'
  ).bind(sessionId).all();
  const { results: correctOpts } = await db.prepare(
    `SELECT qo.id as option_id, qo.question_id FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id WHERE q.exam_id=? AND qo.is_correct=1`
  ).bind(examId).all();
  const correctMap = new Map((correctOpts as any[]).map(o => [o.question_id, o.option_id]));
  const totalQ = await db.prepare('SELECT COUNT(*) as cnt FROM cbt_questions WHERE exam_id=?').bind(examId).first<any>();
  const total = totalQ?.cnt || 0;
  let correct = 0, wrong = 0;
  for (const a of answers as any[]) {
    if (a.selected_option_id === correctMap.get(a.question_id)) correct++;
    else if (a.selected_option_id) wrong++;
  }
  const unanswered = total - correct - wrong;
  const score = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
  await db.prepare(
    `INSERT OR REPLACE INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(newId(), sessionId, examId, userId, userType, total, correct, wrong, unanswered, score).run();
  return { total_questions: total, total_correct: correct, total_wrong: wrong, total_unanswered: unanswered, score };
}

export default student;
