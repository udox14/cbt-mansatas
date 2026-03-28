// ============================================================
// Admin Routes — semua tabel pakai prefix cbt_
// Admin bisa lihat data pendaftar PMB juga
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { hashPassword, generateToken, newId, ok, err, now } from '../utils/helpers';

const admin = new Hono<{ Bindings: Env }>();
admin.use('*', authMiddleware, requireRole('admin'));

// ── ROOMS ────────────────────────────────────────────────────

admin.get('/rooms', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM cbt_rooms ORDER BY room_name').all();
  return c.json(ok(results));
});

admin.post('/rooms', async (c) => {
  const { room_name, capacity } = await c.req.json();
  const id = newId();
  await c.env.DB.prepare('INSERT INTO cbt_rooms (id, room_name, capacity) VALUES (?,?,?)')
    .bind(id, room_name, capacity || 40).run();
  return c.json(ok({ id }, 'Ruangan ditambahkan'), 201);
});

admin.put('/rooms/:id', async (c) => {
  const { room_name, capacity } = await c.req.json();
  await c.env.DB.prepare('UPDATE cbt_rooms SET room_name=?, capacity=? WHERE id=?')
    .bind(room_name, capacity, c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan diperbarui'));
});

admin.delete('/rooms/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_rooms WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan dihapus'));
});

// ── CBT USERS (proktor + student non-PMB) ────────────────────

admin.get('/users', async (c) => {
  const role = c.req.query('role');
  let sql = `SELECT id, username, nama_lengkap as full_name, role, room_id, nisn, is_active, created_at FROM cbt_users`;
  const params: string[] = [];
  if (role) { sql += ' WHERE role = ?'; params.push(role); }
  sql += ' ORDER BY nama_lengkap';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(ok(results));
});

admin.post('/users', async (c) => {
  const body = await c.req.json();
  const { username, password, role, room_id, nisn } = body;
  const nama = body.full_name || body.nama_lengkap;
  if (!username || !password || !nama || !role) return c.json(err('Data tidak lengkap'), 400);
  const hash = await hashPassword(password);
  try {
    const id = newId();
    await c.env.DB.prepare(
      'INSERT INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)'
    ).bind(id, username, hash, nama, role, room_id || null, nisn || null).run();
    return c.json(ok({ id }, 'User ditambahkan'), 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json(err('Username sudah digunakan'), 409);
    throw e;
  }
});

admin.post('/users/bulk', async (c) => {
  const { users } = await c.req.json<{ users: any[] }>();
  if (!users?.length) return c.json(err('Data kosong'), 400);
  const stmt = c.env.DB.prepare(
    'INSERT OR IGNORE INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)'
  );
  const batch = [];
  for (const u of users) {
    const hash = await hashPassword(u.password || u.username);
    batch.push(stmt.bind(newId(), u.username, hash, u.full_name || u.nama_lengkap, u.role || 'student', u.room_id || null, u.nisn || null));
  }
  for (let i = 0; i < batch.length; i += 100) {
    await c.env.DB.batch(batch.slice(i, i + 100));
  }
  return c.json(ok({ imported: users.length }, 'Import user berhasil'));
});

admin.put('/users/:id', async (c) => {
  const body = await c.req.json();
  const nama = body.full_name || body.nama_lengkap;
  let sql = 'UPDATE cbt_users SET nama_lengkap=?, role=?, room_id=?, nisn=?, is_active=?, updated_at=?';
  const params: any[] = [nama, body.role, body.room_id || null, body.nisn || null, body.is_active ?? 1, now()];
  if (body.password) { sql += ', password_hash=?'; params.push(await hashPassword(body.password)); }
  sql += ' WHERE id=?'; params.push(c.req.param('id'));
  await c.env.DB.prepare(sql).bind(...params).run();
  return c.json(ok(null, 'User diperbarui'));
});

admin.delete('/users/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_users WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'User dihapus'));
});

// ── PENDAFTAR PMB (read-only, dari tabel existing) ───────────

admin.get('/pendaftar', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, nisn, nama_lengkap, no_pendaftaran, ruang_tes, jalur, asal_sekolah,
            jenis_kelamin, status_verifikasi, status_kelulusan
     FROM pendaftar ORDER BY nama_lengkap`
  ).all();
  return c.json(ok(results));
});

// ── EXAMS ────────────────────────────────────────────────────

admin.get('/exams', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(q.id) as question_count
     FROM cbt_exams e LEFT JOIN cbt_questions q ON q.exam_id = e.id
     GROUP BY e.id ORDER BY e.created_at DESC`
  ).all();
  return c.json(ok(results));
});

admin.get('/exams/:id', async (c) => {
  const exam = await c.env.DB.prepare('SELECT * FROM cbt_exams WHERE id=?').bind(c.req.param('id')).first();
  if (!exam) return c.json(err('Ujian tidak ditemukan'), 404);
  return c.json(ok(exam));
});

admin.post('/exams', async (c) => {
  const b = await c.req.json();
  const user = c.get('user');
  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_exams (id, title, description, duration_minutes, rules_text, completion_message,
     is_score_visible, randomize_questions, randomize_options, active_status, passing_score, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, b.title, b.description || null, b.duration_minutes || 60,
    b.rules_text || null, b.completion_message || 'Ujian telah selesai. Terima kasih.',
    b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0,
    b.randomize_options ? 1 : 0, b.active_status || 'draft', b.passing_score || 0, user.sub
  ).run();
  return c.json(ok({ id }, 'Ujian dibuat'), 201);
});

admin.put('/exams/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cbt_exams SET title=?, description=?, duration_minutes=?, rules_text=?,
     completion_message=?, is_score_visible=?, randomize_questions=?, randomize_options=?,
     active_status=?, passing_score=?, updated_at=? WHERE id=?`
  ).bind(b.title, b.description, b.duration_minutes, b.rules_text, b.completion_message,
    b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0, b.randomize_options ? 1 : 0,
    b.active_status, b.passing_score || 0, now(), c.req.param('id')
  ).run();
  return c.json(ok(null, 'Ujian diperbarui'));
});

admin.delete('/exams/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_exams WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Ujian dihapus'));
});

// ── QUESTIONS ────────────────────────────────────────────────

admin.get('/exams/:examId/questions', async (c) => {
  const examId = c.req.param('examId');
  const { results: questions } = await c.env.DB.prepare(
    'SELECT * FROM cbt_questions WHERE exam_id=? ORDER BY question_order'
  ).bind(examId).all();
  const qIds = questions.map((q: any) => q.id);
  if (qIds.length === 0) return c.json(ok([]));
  const ph = qIds.map(() => '?').join(',');
  const { results: options } = await c.env.DB.prepare(
    `SELECT * FROM cbt_question_options WHERE question_id IN (${ph}) ORDER BY option_order`
  ).bind(...qIds).all();
  const optMap: Record<string, any[]> = {};
  for (const o of options as any[]) { if (!optMap[o.question_id]) optMap[o.question_id] = []; optMap[o.question_id].push(o); }
  return c.json(ok(questions.map((q: any) => ({ ...q, options: optMap[q.id] || [] }))));
});

admin.post('/exams/:examId/questions', async (c) => {
  const examId = c.req.param('examId');
  const { question_text, question_type, question_order, image_url, audio_url, points, options } = await c.req.json();
  const qId = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(qId, examId, question_text, question_type || 'multiple_choice', question_order || 0, image_url || null, audio_url || null, points || 1).run();
  if (options?.length) {
    const stmts = options.map((o: any, i: number) =>
      c.env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
        .bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok({ id: qId }, 'Soal ditambahkan'), 201);
});

admin.post('/exams/:examId/questions/bulk', async (c) => {
  const examId = c.req.param('examId');
  const { questions } = await c.req.json<{ questions: any[] }>();
  for (const q of questions) {
    const qId = newId();
    await c.env.DB.prepare(
      `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(qId, examId, q.question_text, q.question_type || 'multiple_choice', q.question_order || 0, q.image_url || null, q.audio_url || null, q.points || 1).run();
    if (q.options?.length) {
      const stmts = q.options.map((o: any, i: number) =>
        c.env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
          .bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
      );
      await c.env.DB.batch(stmts);
    }
  }
  return c.json(ok({ imported: questions.length }, 'Soal berhasil diimport'));
});

admin.put('/questions/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cbt_questions SET question_text=?, question_type=?, question_order=?, image_url=?, audio_url=?, points=? WHERE id=?`
  ).bind(b.question_text, b.question_type, b.question_order, b.image_url || null, b.audio_url || null, b.points || 1, c.req.param('id')).run();
  if (b.options) {
    await c.env.DB.prepare('DELETE FROM cbt_question_options WHERE question_id=?').bind(c.req.param('id')).run();
    const stmts = b.options.map((o: any, i: number) =>
      c.env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
        .bind(newId(), c.req.param('id'), o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok(null, 'Soal diperbarui'));
});

admin.delete('/questions/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_questions WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Soal dihapus'));
});

// ── EXAM TOKENS ──────────────────────────────────────────────

admin.get('/exams/:examId/tokens', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT et.*, r.room_name FROM cbt_exam_tokens et JOIN cbt_rooms r ON r.id = et.room_id WHERE et.exam_id=? ORDER BY r.room_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

admin.post('/exams/:examId/tokens/generate', async (c) => {
  const examId = c.req.param('examId');
  const { room_ids } = await c.req.json<{ room_ids?: string[] }>();
  const targetRooms = room_ids?.length
    ? room_ids
    : (await c.env.DB.prepare('SELECT id FROM cbt_rooms').all()).results.map((r: any) => r.id);
  const stmts = targetRooms.map((rid: string) =>
    c.env.DB.prepare('INSERT OR REPLACE INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active) VALUES (?,?,?,?,1)')
      .bind(newId(), examId, rid, generateToken())
  );
  for (let i = 0; i < stmts.length; i += 100) { await c.env.DB.batch(stmts.slice(i, i + 100)); }
  return c.json(ok({ generated: targetRooms.length }, 'Token berhasil digenerate'));
});

// ── R2 UPLOAD ────────────────────────────────────────────────

admin.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  if (!file) return c.json(err('File tidak ditemukan'), 400);
  const ext = file.name.split('.').pop() || 'bin';
  const key = `media/${Date.now()}-${newId().slice(0, 8)}.${ext}`;
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return c.json(ok({ key, url: `/r2/${key}` }, 'Upload berhasil'));
});

// ── RESULTS ──────────────────────────────────────────────────

admin.get('/exams/:examId/results', async (c) => {
  // Join ke pendaftar ATAU cbt_users tergantung user_type
  const { results } = await c.env.DB.prepare(
    `SELECT er.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_results er
     JOIN cbt_exam_sessions es ON es.id = er.session_id
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON er.user_id = p.id AND er.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON er.user_id = cu.id AND er.user_type = 'cbt_user'
     WHERE er.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

// ── LIVE MONITORING ──────────────────────────────────────────

admin.get('/exams/:examId/sessions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT es.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_sessions es
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON es.user_id = p.id AND es.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
     WHERE es.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

export default admin;
