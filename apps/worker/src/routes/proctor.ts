// ============================================================
// Proctor Routes — cbt_ prefix
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { ok, err, now, parseSesiJam, cekJadwal } from '../utils/helpers';

const VIOLATION_LABELS: Record<string, string> = {
  tab_switch:       'Pindah Tab / Minimize Window',
  fullscreen_exit:  'Keluar Fullscreen',
};

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
     ORDER BY et.tanggal_tes, et.sesi_tes, e.title`
  ).bind(user.room_id).all();
  const enriched = (results as any[]).map(t => {
    const parsed = parseSesiJam(t.sesi_tes || '');
    const jadwal_status = t.tanggal_tes && parsed
      ? cekJadwal(t.tanggal_tes, parsed.jamMulai, parsed.jamSelesai)
      : 'no_schedule';
    return { ...t, jadwal_status };
  }).filter(t => t.jadwal_status !== 'selesai');
  return c.json(ok(enriched));
});

proctor.get('/sessions', async (c) => {
  const user = c.get('user');
  if (!user.room_id) return c.json(err('Anda belum di-assign ke ruangan'), 400);
  const examId = c.req.query('exam_id');
  let sql = `
    SELECT es.id, es.exam_id, es.user_id, es.user_type, es.status, es.cheat_warnings,
           es.started_at, es.finished_at, es.last_heartbeat, es.device_id, es.is_time_locked,
           COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
           COALESCE(p.nisn, cu.nisn) as nisn,
           COALESCE(p.sesi_tes, '') as sesi_tes,
           e.title as exam_title,
           e.duration_minutes,
           COALESCE(ac.answered_count, 0) as answered_count,
           COALESCE(qc.total_questions, 0) as total_questions
    FROM cbt_exam_sessions es
    JOIN cbt_exams e ON e.id = es.exam_id
    LEFT JOIN pendaftar p ON es.user_id = p.id AND es.user_type = 'pendaftar'
    LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
    LEFT JOIN (
      SELECT session_id, COUNT(*) as answered_count
      FROM cbt_student_answers
      GROUP BY session_id
    ) ac ON ac.session_id = es.id
    LEFT JOIN (
      SELECT exam_id, COUNT(*) as total_questions
      FROM cbt_questions
      GROUP BY exam_id
    ) qc ON qc.exam_id = es.exam_id
    WHERE es.room_id = ? AND (p.id IS NOT NULL OR cu.id IS NOT NULL)`;
  const params: any[] = [user.room_id];
  if (examId) { sql += ' AND es.exam_id = ?'; params.push(examId); }
  sql += ' ORDER BY full_name';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  const enriched = results.map((s: any) => {
    const diff = Date.now() - new Date(s.last_heartbeat).getTime();
    let live_status = 'offline';
    if (s.status === 'submitted' || s.status === 'force_submitted') live_status = 'selesai';
    else if (s.is_time_locked) live_status = 'dikunci';
    else if (diff < 30000) live_status = 'online';
    return { ...s, live_status };
  });
  return c.json(ok(enriched));
});

// Reset device lock
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

// Unlock time lock — buka kembali sesi yang dikunci karena waktu habis
proctor.post('/sessions/:id/unlock', async (c) => {
  const user = c.get('user');
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id = ? AND room_id = ?'
  ).bind(c.req.param('id'), user.room_id).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan di ruangan Anda'), 404);
  if (session.status === 'submitted' || session.status === 'force_submitted')
    return c.json(err('Ujian sudah selesai, tidak bisa dibuka'), 400);
  // Reset cheat_warnings juga agar peserta tidak langsung kena lock lagi setelah dibuka
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET is_time_locked = 0, cheat_warnings = 0, last_heartbeat = ? WHERE id = ?`
  ).bind(now(), c.req.param('id')).run();
  return c.json(ok(null, 'Sesi berhasil dibuka'));
});

// ── GET cheat logs per sesi ───────────────────────────────────
proctor.get('/sessions/:id/cheat-logs', async (c) => {
  const user = c.get('user');
  // Verifikasi sesi milik ruangan proktor ini
  const session = await c.env.DB.prepare(
    'SELECT id FROM cbt_exam_sessions WHERE id = ? AND room_id = ?'
  ).bind(c.req.param('id'), user.room_id).first();
  if (!session) return c.json(err('Sesi tidak ditemukan di ruangan Anda'), 404);

  const { results } = await c.env.DB.prepare(
    'SELECT id, violation_type, happened_at FROM cbt_cheat_logs WHERE session_id = ? ORDER BY happened_at ASC'
  ).bind(c.req.param('id')).all();

  const enriched = (results as any[]).map((row, idx) => ({
    no: idx + 1,
    violation_type: row.violation_type,
    violation_label: VIOLATION_LABELS[row.violation_type] || row.violation_type,
    happened_at: row.happened_at,
  }));

  return c.json(ok(enriched));
});

// Force submit — proktor bisa paksa submit sesi aktif (darurat)
proctor.post('/sessions/:id/force-submit', async (c) => {
  const user = c.get('user');
  const session = await c.env.DB.prepare(
    `SELECT es.*, e.duration_minutes FROM cbt_exam_sessions es
     JOIN cbt_exams e ON e.id = es.exam_id
     WHERE es.id = ? AND es.room_id = ?`
  ).bind(c.req.param('id'), user.room_id).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan di ruangan Anda'), 404);
  if (session.status === 'submitted' || session.status === 'force_submitted')
    return c.json(err('Ujian sudah selesai'), 400);
  await c.env.DB.prepare(
    `UPDATE cbt_exam_sessions SET status='force_submitted', finished_at=?, is_time_locked=0, last_heartbeat=? WHERE id=?`
  ).bind(now(), now(), session.id).run();
  // Hitung skor
  try {
    const { results: answers } = await c.env.DB.prepare(
      'SELECT * FROM cbt_student_answers WHERE session_id=?'
    ).bind(session.id).all();
    const { results: qOpts } = await c.env.DB.prepare(
      `SELECT qo.id, qo.question_id, qo.is_correct FROM cbt_question_options qo
       JOIN cbt_questions q ON q.id = qo.question_id WHERE q.exam_id=?`
    ).bind(session.exam_id).all();
    const correctSet = new Set((qOpts as any[]).filter((o: any) => o.is_correct).map((o: any) => o.id));
    let correct = 0; let wrong = 0;
    for (const a of answers as any[]) {
      if (a.selected_option_id) { if (correctSet.has(a.selected_option_id)) correct++; else wrong++; }
    }
    const total = (qOpts as any[]).map((o: any) => o.question_id).filter((v, i, a) => a.indexOf(v) === i).length;
    const score = total > 0 ? Math.round((correct / total) * 100) : 0;
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_correct, total_wrong, total_unanswered, score, calculated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(c.env.DB ? undefined : null, session.id, session.exam_id, session.user_id, session.user_type, correct, wrong, total - correct - wrong, score, now()).run();
  } catch {}
  return c.json(ok(null, 'Ujian berhasil di-force submit'));
});

export default proctor;
