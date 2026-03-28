// ============================================================
// Proctor Routes — cbt_ prefix
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { ok, err, now } from '../utils/helpers';

const proctor = new Hono<{ Bindings: Env }>();
proctor.use('*', authMiddleware, requireRole('proctor'));

proctor.get('/token', async (c) => {
  const user = c.get('user');
  if (!user.room_id) return c.json(err('Anda belum di-assign ke ruangan'), 400);
  const { results } = await c.env.DB.prepare(
    `SELECT et.*, e.title as exam_title, r.room_name
     FROM cbt_exam_tokens et
     JOIN cbt_exams e ON e.id = et.exam_id
     JOIN cbt_rooms r ON r.id = et.room_id
     WHERE et.room_id = ? AND et.is_active = 1 AND e.active_status = 'active'
     ORDER BY e.title`
  ).bind(user.room_id).all();
  return c.json(ok(results));
});

proctor.get('/sessions', async (c) => {
  const user = c.get('user');
  if (!user.room_id) return c.json(err('Anda belum di-assign ke ruangan'), 400);
  const examId = c.req.query('exam_id');
  let sql = `
    SELECT es.id, es.exam_id, es.user_id, es.user_type, es.status, es.cheat_warnings,
           es.started_at, es.finished_at, es.last_heartbeat, es.device_id,
           COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
           COALESCE(p.nisn, cu.nisn) as nisn,
           e.title as exam_title,
           (SELECT COUNT(*) FROM cbt_student_answers sa WHERE sa.session_id = es.id) as answered_count,
           (SELECT COUNT(*) FROM cbt_questions q WHERE q.exam_id = es.exam_id) as total_questions
    FROM cbt_exam_sessions es
    JOIN cbt_exams e ON e.id = es.exam_id
    LEFT JOIN pendaftar p ON es.user_id = p.id AND es.user_type = 'pendaftar'
    LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
    WHERE es.room_id = ?`;
  const params: any[] = [user.room_id];
  if (examId) { sql += ' AND es.exam_id = ?'; params.push(examId); }
  sql += ' ORDER BY full_name';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  const enriched = results.map((s: any) => {
    const diff = Date.now() - new Date(s.last_heartbeat).getTime();
    let live_status = 'offline';
    if (s.status === 'submitted' || s.status === 'force_submitted') live_status = 'selesai';
    else if (diff < 30000) live_status = 'online';
    return { ...s, live_status };
  });
  return c.json(ok(enriched));
});

proctor.post('/sessions/:id/reset', async (c) => {
  const user = c.get('user');
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id = ? AND room_id = ?'
  ).bind(c.req.param('id'), user.room_id).first();
  if (!session) return c.json(err('Sesi tidak ditemukan di ruangan Anda'), 404);
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET device_id = NULL, status = 'active', last_heartbeat = ? WHERE id = ?`
  ).bind(now(), c.req.param('id')).run();
  return c.json(ok(null, 'Sesi berhasil direset'));
});

export default proctor;
