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

/**
 * Prepares the atomic D1PreparedStatement list for creating a canonical question
 * and its options. Reusable by createQuestion, bulkCreateQuestions, and acceptAiDrafts
 * to guarantee identical canonical invariants and transactional atomicity.
 */
export function prepareCanonicalQuestionStatements(
  db: D1Database,
  examId: string,
  b: any,
  explicitQId?: string
): { qId: string; statements: D1PreparedStatement[] } {
  const type = b?.question_type || 'multiple_choice';
  const qId = explicitQId || newId();
  const points = Number.isFinite(Number(b.points)) && Number(b.points) > 0 ? Number(b.points) : 1;

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      qId, examId, b?.question_text || '', type, Number(b?.question_order || 0),
      b?.image_url || null, b?.audio_url || null, points
    )
  ];

  if (type === 'multiple_choice' && Array.isArray(b?.options) && b?.options.length) {
    for (let i = 0; i < b.options.length; i++) {
      const o = b.options[i];
      statements.push(
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

  return { qId, statements };
}

export async function createQuestion(db: D1Database, examId: string, b: any) {
  const { qId, statements } = prepareCanonicalQuestionStatements(db, examId, b);
  await db.batch(statements);
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
  await db.batch([
    db.prepare('DELETE FROM cbt_question_options WHERE question_id=?').bind(id),
    db.prepare('DELETE FROM cbt_questions WHERE id=?').bind(id),
  ]);
  return { success: true, data: null, message: 'Soal dihapus' };
}

/**
 * Safely deletes ALL questions and options for an exam in a single-parameter atomic batch.
 * Guarantees zero SQLite variable overflow regardless of question count.
 */
export async function deleteAllExamQuestions(db: D1Database, examId: string) {
  // 1. Verify exam existence & lifecycle
  const exam = await db
    .prepare('SELECT id, active_status, is_frozen FROM cbt_exams WHERE id = ?')
    .bind(examId)
    .first<any>();
  if (!exam) return { success: false, error: 'Ujian tidak ditemukan', status: 404 };

  if (
    exam.is_frozen === 1 ||
    ['ready', 'active', 'completed', 'archived', 'finished'].includes(exam.active_status)
  ) {
    return {
      success: false,
      error: `Ujian dalam status '${exam.active_status}'. Penghapusan soal hanya dapat dilakukan pada status Draft/Konfigurasi.`,
      status: 409,
    };
  }

  // 2. Prevent deletion if student exam sessions exist
  const sessionRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id = ?')
    .bind(examId)
    .first<any>();
  if (Number(sessionRow?.cnt || 0) > 0) {
    return {
      success: false,
      error: 'Tidak dapat menghapus soal karena sudah terdapat sesi ujian peserta untuk ujian ini.',
      status: 409,
    };
  }

  // 3. Count questions to report deleted count
  const countRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_questions WHERE exam_id = ?')
    .bind(examId)
    .first<any>();
  const count = Number(countRow?.cnt || 0);
  if (count === 0) {
    return { success: true, count: 0, message: 'Tidak ada soal untuk dihapus' };
  }

  // 4. Safe single-parameter atomic batch execution
  await db.batch([
    db
      .prepare(
        'DELETE FROM cbt_question_options WHERE question_id IN (SELECT id FROM cbt_questions WHERE exam_id = ?)'
      )
      .bind(examId),
    db.prepare('DELETE FROM cbt_questions WHERE exam_id = ?').bind(examId),
  ]);

  return { success: true, count, message: `${count} butir soal berhasil dihapus` };
}

/**
 * Safely deletes selected questions for an exam in chunks of 50.
 * Guarantees zero SQLite variable overflow even for large question selections.
 */
export async function deleteQuestionsBatch(
  db: D1Database,
  examId: string,
  questionIds: string[]
) {
  if (!Array.isArray(questionIds) || questionIds.length === 0) {
    return { success: false, error: 'Pilih setidaknya satu butir soal untuk dihapus', status: 400 };
  }

  // 1. Verify exam existence & lifecycle
  const exam = await db
    .prepare('SELECT id, active_status, is_frozen FROM cbt_exams WHERE id = ?')
    .bind(examId)
    .first<any>();
  if (!exam) return { success: false, error: 'Ujian tidak ditemukan', status: 404 };

  if (
    exam.is_frozen === 1 ||
    ['ready', 'active', 'completed', 'archived', 'finished'].includes(exam.active_status)
  ) {
    return {
      success: false,
      error: `Ujian dalam status '${exam.active_status}'. Penghapusan soal hanya dapat dilakukan pada status Draft/Konfigurasi.`,
      status: 409,
    };
  }

  // 2. Prevent deletion if student exam sessions exist
  const sessionRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id = ?')
    .bind(examId)
    .first<any>();
  if (Number(sessionRow?.cnt || 0) > 0) {
    return {
      success: false,
      error: 'Tidak dapat menghapus soal karena sudah terdapat sesi ujian peserta untuk ujian ini.',
      status: 409,
    };
  }

  // 3. Chunk IDs to guarantee safe parameter counts (<= 50 per statement)
  const CHUNK_SIZE = 50;
  let deletedCount = 0;

  for (let i = 0; i < questionIds.length; i += CHUNK_SIZE) {
    const chunk = questionIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');

    await db.batch([
      db
        .prepare(`DELETE FROM cbt_question_options WHERE question_id IN (${placeholders})`)
        .bind(...chunk),
      db
        .prepare(`DELETE FROM cbt_questions WHERE id IN (${placeholders}) AND exam_id = ?`)
        .bind(...chunk, examId),
    ]);
    deletedCount += chunk.length;
  }

  // 4. Re-sequence question_order of remaining questions
  const remaining = await db
    .prepare(
      'SELECT id FROM cbt_questions WHERE exam_id = ? ORDER BY question_order ASC, created_at ASC'
    )
    .bind(examId)
    .all<any>();

  const remainingRows = (remaining.results || []) as any[];
  if (remainingRows.length > 0) {
    const reorderStmts = remainingRows.map((row, idx) =>
      db.prepare('UPDATE cbt_questions SET question_order = ? WHERE id = ?').bind(idx + 1, row.id)
    );
    for (let i = 0; i < reorderStmts.length; i += 50) {
      await db.batch(reorderStmts.slice(i, i + 50));
    }
  }

  return {
    success: true,
    count: deletedCount,
    message: `${deletedCount} butir soal berhasil dihapus`,
  };
}
