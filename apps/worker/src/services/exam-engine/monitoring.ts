export async function getExamSessions(db: D1Database, examId: string, roomId?: string | null) {
  let sql = `SELECT es.*,
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
     WHERE es.exam_id = ?`;

  const params: any[] = [examId];
  if (roomId) {
    sql += ' AND es.room_id = ?';
    params.push(roomId);
  }
  sql += " ORDER BY COALESCE(r.room_name, ''), full_name";

  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

import { recomputeMissingExamResults } from './scoring.ts';

export async function unlockExamSession(db: D1Database, sessionId: string) {
  const session = await db.prepare('SELECT id FROM cbt_exam_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) return { success: false, error: 'Sesi tidak ditemukan' };
  await db.prepare(
    "UPDATE cbt_exam_sessions SET is_time_locked = 0, locked_at = NULL, last_heartbeat = datetime('now') WHERE id = ?"
  ).bind(sessionId).run();
  return { success: true, data: null, message: 'Sesi berhasil di-unlock' };
}

export async function resetSessionDevice(db: D1Database, sessionId: string) {
  const session = await db.prepare('SELECT id FROM cbt_exam_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) return { success: false, error: 'Sesi tidak ditemukan' };
  await db.prepare(
    "UPDATE cbt_exam_sessions SET is_time_locked = 0, cheat_warnings = 0, locked_at = NULL, last_heartbeat = datetime('now') WHERE id = ?"
  ).bind(sessionId).run();
  return { success: true, data: null, message: 'Device lock berhasil direset' };
}

export async function forceSubmitSession(db: D1Database, sessionId: string) {
  const session = await db.prepare('SELECT id, exam_id FROM cbt_exam_sessions WHERE id = ?').bind(sessionId).first<any>();
  if (!session) return { success: false, error: 'Sesi tidak ditemukan' };
  await db.prepare(
    "UPDATE cbt_exam_sessions SET status = 'submitted', finished_at = datetime('now'), is_time_locked = 0, locked_at = NULL, last_heartbeat = datetime('now') WHERE id = ?"
  ).bind(sessionId).run();
  await recomputeMissingExamResults(db, session.exam_id);
  return { success: true, data: null, message: 'Sesi berhasil di-force submit' };
}
