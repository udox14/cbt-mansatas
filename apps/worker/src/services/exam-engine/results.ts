export async function getAssignedResultParticipants(db: D1Database, examId: string) {
  const { results: roomRows } = await db.prepare('SELECT id, room_name FROM cbt_rooms').all();
  const roomNameToIdMap = new Map<string, string>();
  for (const r of (roomRows as any[]) || []) roomNameToIdMap.set(r.room_name, r.id);

  const participants = new Map<string, any>();
  const add = (row?: any) => {
    if (!row?.user_id || !row?.user_type) return;
    participants.set(`${row.user_type}:${row.user_id}`, {
      user_id: row.user_id,
      user_type: row.user_type,
      full_name: row.full_name || '',
      nisn: row.nisn || '',
      username: row.username || row.nisn || '',
      class_name: row.class_name || row.grade || row.room_name || '',
      grade: row.grade || '',
      asal_sekolah: row.asal_sekolah || '',
      pilihan_pesantren: row.pilihan_pesantren || '',
      room_id: row.room_id || (row.room_name ? roomNameToIdMap.get(row.room_name) || '' : ''),
      room_name: row.room_name || '',
      tanggal_tes: row.tanggal_tes || '',
      sesi_tes: row.sesi_tes || '',
    });
  };
  const addAll = (rows: any[] = []) => rows.forEach(add);

  // 1. Fetch from cbt_exam_roster
  const { results: rosterRows } = await db.prepare(
    `SELECT r.source_id as user_id,
            CASE WHEN r.source_key = 'pmb' THEN 'pendaftar' ELSE r.source_key END as user_type,
            r.full_name, COALESCE(r.nisn, r.username) as nisn, r.username,
            COALESCE(r.class_name, r.grade, rm.room_name, '') as class_name,
            COALESCE(r.grade, '') as grade,
            r.tanggal_tes, r.sesi_tes, r.room_id, COALESCE(rm.room_name, '') as room_name,
            COALESCE(r.metadata_json, '{}') as metadata_json
     FROM cbt_exam_roster r
     LEFT JOIN cbt_rooms rm ON rm.id = r.room_id
     WHERE r.exam_id=?`
  ).bind(examId).all();
  addAll((rosterRows as any[]) || []);

  // 2. Fetch from cbt_exam_assignments
  const { results: assignments } = await db.prepare(
    'SELECT user_id, user_type FROM cbt_exam_assignments WHERE exam_id=?'
  ).bind(examId).all();

  const manualStudentSelect = `
    SELECT cu.id as user_id, 'cbt_user' as user_type,
           cu.nama_lengkap as full_name, cu.nisn, cu.username,
           COALESCE(cu.class_name, cu.grade, r.room_name, '') as class_name,
           COALESCE(cu.grade, '') as grade,
           '' as asal_sekolah, '' as pilihan_pesantren, '' as tanggal_tes, '' as sesi_tes,
           r.id as room_id, COALESCE(r.room_name, '') as room_name
    FROM cbt_users cu
    LEFT JOIN cbt_rooms r ON r.id = cu.room_id
  `;

  for (const assignment of (assignments as any[]) || []) {
    if (assignment.user_type === 'cbt_user') {
      const row = await db.prepare(
        `${manualStudentSelect}
         WHERE cu.id=? AND cu.role='student' AND cu.is_active=1`
      ).bind(assignment.user_id).first<any>();
      add(row);
      continue;
    }

    if (assignment.user_type === 'room') {
      const room = roomNameToIdMap.get(assignment.user_id) || assignment.user_id;
      const { results: manualRows } = await db.prepare(
        `${manualStudentSelect}
         WHERE cu.room_id=? AND cu.role='student' AND cu.is_active=1
         ORDER BY cu.nama_lengkap`
      ).bind(room).all();
      addAll((manualRows as any[]) || []);
    }
  }

  return Array.from(participants.values()).sort((a, b) =>
    `${a.tanggal_tes} ${a.sesi_tes} ${a.room_name} ${a.full_name}`.localeCompare(
      `${b.tanggal_tes} ${b.sesi_tes} ${b.room_name} ${b.full_name}`
    )
  );
}

export async function getExamResults(db: D1Database, examId: string) {
  const { results } = await db.prepare(
    `SELECT er.*,
       COALESCE(rr.full_name, cu.nama_lengkap) as full_name,
       COALESCE(rr.nisn, cu.nisn) as nisn,
       COALESCE(rr.username, cu.username) as username,
       COALESCE(rr.class_name, '') as class_name,
       COALESCE(rr.grade, '') as grade,
       COALESCE(rr.gender, '') as gender,
       '' as asal_sekolah,
       '' as pilihan_pesantren,
       COALESCE(rr.sesi_tes, '') as sesi_tes,
       COALESCE(rr.tanggal_tes, '') as tanggal_tes,
       r.room_name
     FROM cbt_exam_results er
     JOIN cbt_exam_sessions es ON es.id = er.session_id
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN cbt_users cu ON er.user_id = cu.id AND er.user_type = 'cbt_user'
     LEFT JOIN cbt_exam_roster rr ON rr.exam_id = er.exam_id AND rr.source_id = er.user_id
       AND rr.source_key = CASE WHEN er.user_type = 'pendaftar' THEN 'pmb' ELSE er.user_type END
     WHERE er.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(examId).all();

  return results || [];
}

export async function getExamResultsExport(db: D1Database, examId: string) {
  const participants = await getAssignedResultParticipants(db, examId);

  const { results: progressRows } = await db.prepare(
    `SELECT es.id as session_id, es.user_id, es.user_type, es.status, es.is_time_locked,
            er.total_questions, er.total_correct, er.total_wrong, er.total_unanswered, er.score, er.computed_at
     FROM cbt_exam_sessions es
     LEFT JOIN cbt_exam_results er ON er.session_id = es.id
     WHERE es.exam_id=?`
  ).bind(examId).all();

  const progressByUser = new Map<string, any>();
  for (const row of (progressRows as any[]) || []) {
    progressByUser.set(`${row.user_type}:${row.user_id}`, row);
  }

  return participants.map((participant) => {
    const progress = progressByUser.get(`${participant.user_type}:${participant.user_id}`);
    const isSubmitted = progress?.status === 'submitted' || progress?.computed_at;
    const isLocked = Number(progress?.is_time_locked || 0) === 1;
    return {
      ...participant,
      status_pengerjaan: !progress
        ? 'Belum ikut tes'
        : isSubmitted
          ? 'Selesai'
          : isLocked
            ? 'Dikunci'
            : 'Sedang mengerjakan',
      total_questions: isSubmitted ? progress.total_questions : '',
      total_correct: isSubmitted ? progress.total_correct : '',
      total_wrong: isSubmitted ? progress.total_wrong : '',
      total_unanswered: isSubmitted ? progress.total_unanswered : '',
      score: isSubmitted ? progress.score : '',
    };
  });
}

export async function deleteExamResult(db: D1Database, examId: string, sessionId: string) {
  await db.prepare('DELETE FROM cbt_student_answers WHERE session_id = ?').bind(sessionId).run();
  await db.prepare('DELETE FROM cbt_exam_results WHERE session_id = ?').bind(sessionId).run();
  await db.prepare('DELETE FROM cbt_cheat_logs WHERE session_id = ?').bind(sessionId).run();
  await db.prepare('DELETE FROM cbt_exam_sessions WHERE id = ? AND exam_id = ?').bind(sessionId, examId).run();
  return { success: true, data: null, message: 'Hasil ujian sesi berhasil dihapus' };
}
