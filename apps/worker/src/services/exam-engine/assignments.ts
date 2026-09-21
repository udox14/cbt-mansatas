import { newId } from '../../utils/helpers.ts';


export async function listExamAssignments(db: D1Database, examId: string) {
  const { results } = await db.prepare(
    `SELECT ea.*,
       CASE
         WHEN ea.user_type IN ('room','sesi','tanggal_sesi') THEN ea.user_id
         ELSE COALESCE(rr.full_name, cu.nama_lengkap)
       END as full_name,
       CASE
         WHEN ea.user_type IN ('room','sesi','tanggal_sesi') THEN NULL
         ELSE COALESCE(rr.nisn, cu.nisn, cu.username)
       END as nisn
     FROM cbt_exam_assignments ea
     LEFT JOIN cbt_exam_roster rr ON rr.source_id = ea.user_id AND rr.exam_id = ea.exam_id
     LEFT JOIN cbt_users cu ON ea.user_id = cu.id AND ea.user_type = 'cbt_user'
     WHERE ea.exam_id = ? ORDER BY ea.user_type, full_name`
  ).bind(examId).all();

  return results || [];
}

export async function createExamAssignments(
  db: D1Database,
  examId: string,
  users: { user_id: string; user_type: string }[]
) {
  if (!users?.length) {
    return { success: false, error: 'Pilih minimal 1 peserta', status: 400 };
  }
  const stmts = users.map(u =>
    db.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, u.user_id, u.user_type)
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return { success: true, data: { added: users.length }, message: 'Peserta di-assign' };
}

export async function assignExamRoom(db: D1Database, examId: string, rooms: string[]) {
  if (!rooms?.length) {
    return { success: false, error: 'Pilih minimal 1 ruangan', status: 400 };
  }
  const stmts = rooms.map(roomName =>
    db.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, roomName, 'room')
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return { success: true, data: { added: rooms.length }, message: `${rooms.length} ruangan di-assign` };
}

export async function assignExamSesi(db: D1Database, examId: string, sessions: string[]) {
  if (!sessions?.length) {
    return { success: false, error: 'Pilih minimal 1 sesi', status: 400 };
  }
  const stmts = sessions.map(sesi =>
    db.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, sesi, 'sesi')
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return { success: true, data: { added: sessions.length }, message: `${sessions.length} sesi di-assign` };
}

export async function assignExamGroup(
  db: D1Database,
  examId: string,
  groups: { tanggal_tes: string; sesi_tes: string }[]
) {
  if (!groups?.length) {
    return { success: false, error: 'Pilih minimal 1 kelompok', status: 400 };
  }
  const stmts = groups.map(g =>
    db.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, `${g.tanggal_tes}|${g.sesi_tes}`, 'tanggal_sesi')
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return { success: true, data: { added: groups.length }, message: `${groups.length} kelompok di-assign` };
}

export async function batchDeleteExamAssignments(db: D1Database, examId: string, ids: string[]) {
  const cleanIds = Array.from(new Set((ids || []).filter(Boolean)));
  if (!cleanIds.length) {
    return { success: false, error: 'Pilih minimal 1 assignment', status: 400 };
  }
  const stmts = cleanIds.map(id =>
    db.prepare('DELETE FROM cbt_exam_assignments WHERE id=? AND exam_id=?').bind(id, examId)
  );
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
  return { success: true, data: { deleted: cleanIds.length }, message: `${cleanIds.length} assignment dihapus` };
}

export async function deleteExamAssignment(db: D1Database, examId: string, id: string) {
  await db.prepare('DELETE FROM cbt_exam_assignments WHERE id=? AND exam_id=?').bind(id, examId).run();
  return { success: true, data: null, message: 'Assignment dihapus' };
}
