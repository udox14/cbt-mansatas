export async function getExamSessions(db: D1Database, examId: string) {
  const { results } = await db.prepare(
    `SELECT es.*,
       COALESCE(rr.full_name, cu.nama_lengkap) as full_name,
       COALESCE(rr.nisn, cu.nisn) as nisn,
       COALESCE(rr.username, cu.username) as username,
       COALESCE(rr.sesi_tes, '') as sesi_tes,
       COALESCE(rr.tanggal_tes, '') as tanggal_tes,
       r.room_name,
       COALESCE(cl.cheat_log_count, 0) as cheat_log_count
     FROM cbt_exam_sessions es
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
     LEFT JOIN cbt_exam_roster rr ON rr.exam_id = es.exam_id AND rr.source_id = es.user_id
       AND rr.source_key = CASE WHEN es.user_type = 'pendaftar' THEN 'pmb' ELSE es.user_type END
     LEFT JOIN (
       SELECT session_id, COUNT(*) as cheat_log_count
       FROM cbt_cheat_logs
       GROUP BY session_id
     ) cl ON cl.session_id = es.id
     WHERE es.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(examId).all();

  return results || [];
}
