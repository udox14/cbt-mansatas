export async function getExamQuestionAnalytics(db: D1Database, examId: string) {
  const { results: questions } = await db.prepare(
    `SELECT q.id, q.question_order, q.question_text, q.question_type
     FROM cbt_questions q
     WHERE q.exam_id=?
     ORDER BY q.question_order`
  ).bind(examId).all();

  const { results: options } = await db.prepare(
    `SELECT qo.id, qo.question_id, qo.option_label, qo.option_text, qo.is_correct, qo.option_order
     FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id
     WHERE q.exam_id=?
     ORDER BY q.question_order, qo.option_order`
  ).bind(examId).all();

  const { results: rows } = await db.prepare(
    `SELECT q.id as question_id, a.selected_option_id,
            CASE
              WHEN q.question_type = 'essay' AND TRIM(COALESCE(a.essay_answer, '')) != '' THEN 1
              WHEN q.question_type = 'multiple_choice' AND a.selected_option_id IS NOT NULL THEN 1
              ELSE 0
            END as answered,
            COALESCE(co.is_correct, 0) as is_correct,
            es.id as session_id,
            es.started_at,
            COALESCE(es.finished_at, es.last_heartbeat) as ended_at,
            COALESCE(r.room_name, '-') as room_name,
            COALESCE(rr.tanggal_tes, '') as tanggal_tes,
            COALESCE(rr.sesi_tes, '') as sesi_tes
     FROM cbt_questions q
     JOIN cbt_exam_sessions es ON es.exam_id = q.exam_id
     LEFT JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN cbt_exam_roster rr ON rr.exam_id = es.exam_id AND rr.source_id = es.user_id
       AND rr.source_key = CASE WHEN es.user_type = 'pendaftar' THEN 'pmb' ELSE es.user_type END
     LEFT JOIN cbt_student_answers a ON a.session_id = es.id AND a.question_id = q.id
     LEFT JOIN cbt_question_options co ON co.id = a.selected_option_id
     WHERE q.exam_id=?
       AND es.status = 'submitted'`
  ).bind(examId).all();

  return {
    questions: questions || [],
    options: options || [],
    rows: rows || [],
  };
}
