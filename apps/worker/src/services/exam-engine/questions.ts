import { newId } from '../../utils/helpers.ts';

export async function listExamQuestions(db: D1Database, examId: string) {
  const { results: questions } = await db.prepare(
    `SELECT * FROM cbt_questions WHERE exam_id=? ORDER BY question_order ASC`
  ).bind(examId).all();

  const qList = (questions as any[]) || [];
  if (qList.length === 0) return [];

  const qIds = qList.map(q => q.id);
  const placeholders = qIds.map(() => '?').join(',');
  const { results: options } = await db.prepare(
    `SELECT * FROM cbt_question_options WHERE question_id IN (${placeholders}) ORDER BY option_order ASC`
  ).bind(...qIds).all();

  const optMap: Record<string, any[]> = {};
  for (const o of (options as any[]) || []) {
    if (!optMap[o.question_id]) optMap[o.question_id] = [];
    optMap[o.question_id].push(o);
  }

  return qList.map(q => ({
    ...q,
    options: optMap[q.id] || [],
  }));
}

export async function getQuestionById(db: D1Database, id: string) {
  const q = await db.prepare('SELECT * FROM cbt_questions WHERE id=?').bind(id).first<any>();
  if (!q) return null;
  const { results: options } = await db.prepare(
    'SELECT * FROM cbt_question_options WHERE question_id=? ORDER BY option_order ASC'
  ).bind(id).all();
  return { ...q, options: options || [] };
}

export async function createQuestion(db: D1Database, examId: string, b: any) {
  const type = b?.question_type || 'multiple_choice';
  const qId = newId();
  const points = Number.isFinite(Number(b.points)) && Number(b.points) > 0 ? Number(b.points) : 1;

  await db.prepare(
    `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    qId, examId, b?.question_text || '', type, Number(b?.question_order || 0),
    b?.image_url || null, b?.audio_url || null, points
  ).run();

  if (type === 'multiple_choice' && Array.isArray(b?.options) && b?.options.length) {
    const stmts = b.options.map((o: any, i: number) =>
      db.prepare(
        `INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        newId(), qId, o.option_label || 'ABCDE'[i] || String(i + 1),
        o.option_text || '', o.image_url || null, o.is_correct ? 1 : 0, i
      )
    );
    await db.batch(stmts);
  }

  return { success: true, data: { id: qId }, message: 'Soal ditambahkan', status: 201 };
}

export async function bulkCreateQuestions(db: D1Database, examId: string, questions: any[]) {
  if (!Array.isArray(questions) || !questions.length) {
    return { success: false, error: 'Data soal kosong', status: 400 };
  }

  const allStmts: D1PreparedStatement[] = [];
  for (const q of questions) {
    const qId = newId();
    const type = q.question_type || 'multiple_choice';
    const points = Number.isFinite(Number(q.points)) && Number(q.points) > 0 ? Number(q.points) : 1;

    allStmts.push(
      db.prepare(
        `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(
        qId, examId, q.question_text || '', type, Number(q.question_order || 0),
        q.image_url || null, q.audio_url || null, points
      )
    );

    if (q.options?.length) {
      for (let i = 0; i < q.options.length; i++) {
        const o = q.options[i];
        allStmts.push(
          db.prepare(
            `INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order)
             VALUES (?,?,?,?,?,?,?)`
          ).bind(
            newId(), qId, o.option_label || 'ABCDE'[i] || String(i + 1),
            o.option_text || '', o.image_url || null, o.is_correct ? 1 : 0, i
          )
        );
      }
    }
  }

  for (let i = 0; i < allStmts.length; i += 100) {
    await db.batch(allStmts.slice(i, i + 100));
  }

  return { success: true, data: { imported: questions.length }, message: 'Soal berhasil diimport' };
}

export async function updateQuestion(db: D1Database, id: string, b: any) {
  const existing = await db.prepare('SELECT id FROM cbt_questions WHERE id=?').bind(id).first();
  if (!existing) {
    return { success: false, error: 'Soal tidak ditemukan', status: 404 };
  }

  const type = b.question_type || 'multiple_choice';
  const questionOrder = Number.isFinite(Number(b.question_order)) ? Number(b.question_order) : 0;
  const points = Number.isFinite(Number(b.points)) && Number(b.points) > 0 ? Number(b.points) : 1;

  await db.prepare(
    `UPDATE cbt_questions SET question_text=?, question_type=?, question_order=?, image_url=?, audio_url=?, points=?
     WHERE id=?`
  ).bind(
    b.question_text || '', type, questionOrder,
    b.image_url || null, b.audio_url || null, points, id
  ).run();

  if (Array.isArray(b.options)) {
    await db.prepare('DELETE FROM cbt_question_options WHERE question_id=?').bind(id).run();
    const optionRows = type === 'multiple_choice' ? b.options : [];
    const stmts = optionRows.map((o: any, i: number) =>
      db.prepare(
        `INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        newId(), id, o.option_label || 'ABCDE'[i] || String(i + 1),
        o.option_text || '', o.image_url || null, o.is_correct ? 1 : 0, i
      )
    );
    if (stmts.length) {
      for (let i = 0; i < stmts.length; i += 100) {
        await db.batch(stmts.slice(i, i + 100));
      }
    }
  }

  return { success: true, data: null, message: 'Soal diperbarui' };
}

export async function deleteQuestion(db: D1Database, id: string) {
  await db.prepare('DELETE FROM cbt_questions WHERE id=?').bind(id).run();
  return { success: true, data: null, message: 'Soal dihapus' };
}
