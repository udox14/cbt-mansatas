import { newId } from '../../utils/helpers.ts';


export async function recomputeMissingExamResults(db: D1Database, examId: string): Promise<{ repaired: number }> {
  const { results: sessions } = await db.prepare(
    `SELECT es.id, es.user_id, es.user_type
     FROM cbt_exam_sessions es
     LEFT JOIN cbt_exam_results er ON er.session_id = es.id
     WHERE es.exam_id=? AND es.status='submitted' AND er.session_id IS NULL`
  ).bind(examId).all();

  if (!sessions || !sessions.length) return { repaired: 0 };

  const { results: correctOpts } = await db.prepare(
    `SELECT qo.id as option_id, qo.question_id
     FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id
     WHERE q.exam_id=? AND qo.is_correct=1`
  ).bind(examId).all();
  const correctMap = new Map(((correctOpts as any[]) || []).map(o => [o.question_id, o.option_id]));
  const totalRow = await db.prepare('SELECT COUNT(*) as cnt FROM cbt_questions WHERE exam_id=?')
    .bind(examId).first<any>();
  const total = Number(totalRow?.cnt || 0);

  let repaired = 0;
  for (const session of (sessions as any[])) {
    const { results: answers } = await db.prepare(
      'SELECT question_id, selected_option_id FROM cbt_student_answers WHERE session_id=?'
    ).bind(session.id).all();

    let correct = 0;
    let wrong = 0;
    for (const answer of ((answers as any[]) || [])) {
      if (answer.selected_option_id === correctMap.get(answer.question_id)) correct++;
      else if (answer.selected_option_id) wrong++;
    }

    const unanswered = Math.max(0, total - correct - wrong);
    const score = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
    await db.prepare(
      `INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(session_id) DO UPDATE SET
         total_questions=excluded.total_questions,
         total_correct=excluded.total_correct,
         total_wrong=excluded.total_wrong,
         total_unanswered=excluded.total_unanswered,
         score=excluded.score,
         computed_at=datetime('now')`
    ).bind(newId(), session.id, examId, session.user_id, session.user_type, total, correct, wrong, unanswered, score).run();
    repaired++;
  }

  return { repaired };
}
