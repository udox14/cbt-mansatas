// ============================================================
// AI Question Generator — Shared Authoring Service
// Orchestrates AI generation, lifecycle checks, concurrency,
// structured validation, duplicate detection, and canonical acceptance.
// ============================================================

import type { Env, AiDifficultyMode, AiVariationLevel } from '../../types.ts';
import type { GenerationInput, RawGeneratedQuestion } from '../ai/types.ts';
import { getAiProvider } from '../ai/factory.ts';
import { PROMPT_VERSION } from '../ai/prompt.ts';
import {
  validateRawQuestion,
  computeQuestionContentHash,
  parseProviderJsonResponse,
  normalizeTextForHash,
} from '../ai/validator.ts';
import { createQuestion, prepareCanonicalQuestionStatements } from './questions.ts';
import { newId, now } from '../../utils/helpers.ts';
import { checkRateLimit } from '../../utils/ratelimit.ts';

export const MAX_AI_QUESTIONS_PER_RUN = 20;

export interface GenerateAiQuestionsOptions {
  idempotencyToken?: string;
}

/**
 * Asserts that an exam exists and is in a mutable state.
 * Returns exam and parent event metadata.
 */
export async function assertExamMutableForAi(db: D1Database, examId: string) {
  const exam = await db
    .prepare(
      `SELECT e.*, ev.status AS event_status, ev.code AS event_code, ev.name AS event_name,
              ev.mode AS event_mode
       FROM cbt_exams e
       LEFT JOIN cbt_events ev ON ev.id = e.event_id
       WHERE e.id = ?`
    )
    .bind(examId)
    .first<any>();

  if (!exam) {
    return { success: false, error: 'Ujian tidak ditemukan', status: 404 };
  }

  if (exam.is_frozen === 1) {
    return {
      success: false,
      error: 'Ujian telah dibekukan. Pembuatan dan impor soal AI tidak diizinkan.',
      status: 409,
    };
  }

  const frozenStatuses = ['ready', 'active', 'completed', 'archived', 'finished'];
  if (exam.active_status && frozenStatuses.includes(exam.active_status)) {
    return {
      success: false,
      error: `Ujian dalam status '${exam.active_status}'. Pembuatan dan impor soal AI hanya diizinkan pada status Draft/Configuration.`,
      status: 409,
    };
  }

  if (exam.event_status && ['ready', 'active', 'completed', 'archived'].includes(exam.event_status)) {
    return {
      success: false,
      error: `Event '${exam.event_name || exam.event_id}' telah mencapai status '${exam.event_status}' (soal beku). Pembuatan dan impor soal AI tidak diizinkan.`,
      status: 409,
    };
  }

  return { success: true, exam };
}

/**
 * Asserts that the authenticated caller has valid authorization to author questions
 * for THIS EXACT exam across all 5 canonical modes (PMB, Ulangan, TKA, Semester, Kegiatan).
 * Prevents generic-route ownership bypasses by enforcing the exact same canonical
 * authorization and teacher-ownership rules used in manual domain authoring.
 */
export async function assertAiQuestionAuthoringAccess(
  db: D1Database,
  user: any,
  examId: string
): Promise<{ success: boolean; error?: string; status?: number; exam?: any }> {
  if (!user) {
    return { success: false, error: 'Token autentikasi tidak ditemukan', status: 401 };
  }

  // 1. Student block: students are strictly excluded from AI authoring
  if (user.role === 'student' || (user.roles?.includes('student') && !user.roles?.includes('admin'))) {
    return {
      success: false,
      error: 'Akses ditolak: siswa tidak diizinkan mengakses fitur authoring AI',
      status: 403,
    };
  }

  // 2. Fetch target exam and event context
  const exam = await db
    .prepare(
      `SELECT e.*, ev.status AS event_status, ev.code AS event_code, ev.name AS event_name,
              ev.mode AS event_mode
       FROM cbt_exams e
       LEFT JOIN cbt_events ev ON ev.id = e.event_id
       WHERE e.id = ?`
    )
    .bind(examId)
    .first<any>();

  if (!exam) {
    return { success: false, error: 'Ujian tidak ditemukan', status: 404 };
  }

  // 3. Platform / Super Admin override
  const isGlobalAdmin =
    user.role === 'admin' ||
    user.roles?.includes('admin') ||
    user.permissions?.includes('platform.manage') ||
    user.permissions?.includes('*');

  if (isGlobalAdmin) {
    return { success: true, exam };
  }

  // 4. Domain-specific authorization delegation
  const examMode = exam.mode || exam.event_mode;

  if (examMode === 'ulangan') {
    // Canonical Ulangan ownership: must be the owner teacher
    const staffId = user.staff_id || user.sub;
    if (!exam.owner_staff_id || exam.owner_staff_id !== staffId) {
      return {
        success: false,
        error: 'Akses ditolak: Anda bukan pemilik ulangan ini',
        status: 403,
      };
    }
    const hasUlanganPerm =
      user.permissions?.includes('ulangan.exam.manage_own') ||
      user.permissions?.includes('ulangan.access') ||
      user.permissions?.includes('question.manage');
    if (!hasUlanganPerm && user.role !== 'teacher') {
      return {
        success: false,
        error: 'Akses ditolak: Anda tidak memiliki izin mengelola ulangan',
        status: 403,
      };
    }
    return { success: true, exam };
  }

  if (examMode === 'tka') {
    const hasTkaPerm =
      user.permissions?.includes('tka.event.manage') ||
      user.permissions?.includes('question.manage');
    if (!hasTkaPerm) {
      return {
        success: false,
        error: 'Akses ditolak: Anda tidak memiliki izin mengelola ujian TKA',
        status: 403,
      };
    }
    return { success: true, exam };
  }

  if (examMode === 'semester') {
    const hasSemesterPerm =
      user.permissions?.includes('semester.event.manage') ||
      user.permissions?.includes('question.manage');
    if (!hasSemesterPerm) {
      return {
        success: false,
        error: 'Akses ditolak: Anda tidak memiliki izin mengelola ujian Semester',
        status: 403,
      };
    }
    return { success: true, exam };
  }

  if (examMode === 'kegiatan') {
    const hasKegiatanPerm =
      user.permissions?.includes('kegiatan.event.update') ||
      user.permissions?.includes('kegiatan.event.manage') ||
      user.permissions?.includes('question.manage');
    if (!hasKegiatanPerm) {
      return {
        success: false,
        error: 'Akses ditolak: Anda tidak memiliki izin mengelola kegiatan',
        status: 403,
      };
    }
    return { success: true, exam };
  }

  // PMB or generic mode
  const hasQuestionPerm =
    user.permissions?.includes('question.manage') ||
    user.permissions?.includes('pmb.manage');
  if (!hasQuestionPerm) {
    return {
      success: false,
      error: 'Akses ditolak: Anda tidak memiliki izin mengelola soal ujian',
      status: 403,
    };
  }

  return { success: true, exam };
}

/**
 * Loads existing questions and their options in the target exam
 * to compute content hashes for duplicate detection.
 */
async function loadExistingExamQuestionHashes(db: D1Database, examId: string): Promise<Set<string>> {
  const { results: questions } = await db
    .prepare('SELECT id, question_text FROM cbt_questions WHERE exam_id = ?')
    .bind(examId)
    .all<any>();

  const qList = questions || [];
  if (qList.length === 0) return new Set<string>();

  const qIds = qList.map((q) => q.id);
  const placeholders = qIds.map(() => '?').join(',');
  const { results: options } = await db
    .prepare(
      `SELECT question_id, option_text FROM cbt_question_options WHERE question_id IN (${placeholders})`
    )
    .bind(...qIds)
    .all<any>();

  const optMap = new Map<string, Array<{ text: string }>>();
  for (const opt of options || []) {
    const list = optMap.get(opt.question_id) || [];
    list.push({ text: opt.option_text });
    optMap.set(opt.question_id, list);
  }

  const hashes = new Set<string>();
  for (const q of qList) {
    const opts = optMap.get(q.id) || [];
    const hash = await computeQuestionContentHash(q.question_text, opts);
    hashes.add(hash);
  }

  return hashes;
}

/**
 * Shared AI Question Generation service function.
 */
export async function generateAiQuestions(
  db: D1Database,
  env: Env,
  examId: string,
  actorStaffId: string,
  input: {
    topic: string;
    question_count?: number;
    questionCount?: number;
    difficulty_mode?: string;
    difficultyMode?: string;
    variation_level?: string;
    variationLevel?: string;
    additional_instruction?: string;
    additionalInstruction?: string;
    reference_text?: string;
    referenceText?: string;
    idempotency_token?: string;
    idempotencyToken?: string;
  }
) {
  // 1. Assert exam is mutable
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success || !examCheck.exam) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }
  const exam = examCheck.exam;

  // 2. Validate user inputs
  const topic = (input.topic || '').trim();
  if (!topic) {
    return { success: false, error: 'Topik / materi soal wajib diisi', status: 400 };
  }
  if (topic.length > 1000) {
    return { success: false, error: 'Topik soal maksimal 1.000 karakter', status: 400 };
  }

  const rawCount = Number(input.question_count ?? input.questionCount ?? 5);
  const maxAllowed = Number(env.MAX_AI_QUESTIONS_PER_RUN) || MAX_AI_QUESTIONS_PER_RUN;
  if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > maxAllowed) {
    return {
      success: false,
      error: `Jumlah soal harus antara 1 dan ${maxAllowed}`,
      status: 400,
    };
  }

  const validDiffModes: AiDifficultyMode[] = ['easy', 'balanced', 'hard'];
  const rawDiff = String(input.difficulty_mode || input.difficultyMode || 'balanced').toLowerCase();
  const difficultyMode: AiDifficultyMode = validDiffModes.includes(rawDiff as any)
    ? (rawDiff as AiDifficultyMode)
    : 'balanced';

  const validVarLevels: AiVariationLevel[] = ['standard', 'varied', 'high_variation'];
  const rawVar = String(input.variation_level || input.variationLevel || 'standard').toLowerCase();
  const variationLevel: AiVariationLevel = validVarLevels.includes(rawVar as any)
    ? (rawVar as AiVariationLevel)
    : 'standard';

  const additionalInstruction = (input.additional_instruction || input.additionalInstruction || '').trim();
  if (additionalInstruction.length > 2000) {
    return { success: false, error: 'Instruksi tambahan maksimal 2.000 karakter', status: 400 };
  }

  const referenceText = (input.reference_text || input.referenceText || '').trim();
  if (referenceText.length > 20000) {
    return { success: false, error: 'Teks referensi maksimal 20.000 karakter', status: 400 };
  }

  const idempotencyToken = (input.idempotency_token || input.idempotencyToken || '').trim() || null;

  // 3. Rate limiting (KV-based if available)
  if (env.RATE_LIMIT) {
    const rl = await checkRateLimit(env.RATE_LIMIT, `ai:generate:${actorStaffId}`, 10, 300);
    if (!rl.allowed) {
      return {
        success: false,
        error: 'Batas kuota pembuatan soal AI terlampaui. Silakan tunggu beberapa menit.',
        status: 429,
      };
    }
  }

  // 4. Concurrency & Idempotency Check
  // A. If idempotency token provided and run already exists, return it
  if (idempotencyToken) {
    const existingRun = await db
      .prepare('SELECT * FROM cbt_ai_generation_runs WHERE idempotency_token = ?')
      .bind(idempotencyToken)
      .first<any>();

    if (existingRun) {
      const drafts = await listAiDrafts(db, examId, existingRun.id);
      return {
        success: true,
        data: {
          runId: existingRun.id,
          status: existingRun.status,
          requestedCount: existingRun.requested_count,
          generatedCount: existingRun.generated_count,
          validCount: existingRun.valid_count,
          rejectedCount: existingRun.rejected_count,
          drafts,
        },
        message: 'Hasil generasi soal yang ada dikembalikan (idempotent)',
      };
    }
  }

  // B. Double-click concurrency protection: check if run is currently active for this actor + exam
  const activeRun = await db
    .prepare(
      `SELECT id, created_at, (strftime('%s', 'now') - strftime('%s', created_at)) AS age_seconds
       FROM cbt_ai_generation_runs
       WHERE exam_id = ? AND actor_staff_id = ? AND status = 'running'`
    )
    .bind(examId, actorStaffId)
    .first<any>();

  if (activeRun) {
    const ageSeconds = Number(activeRun.age_seconds || 0);
    if (ageSeconds > 300) {
      // Auto-recover stale abandoned lock
      await db
        .prepare(
          `UPDATE cbt_ai_generation_runs
           SET status = 'failed', error_code = 'TIMEOUT_STALE',
               error_message = 'Proses generasi sebelumnya kedaluwarsa (stale lock auto-recovered)',
               completed_at = datetime('now')
           WHERE id = ?`
        )
        .bind(activeRun.id)
        .run();
    } else {
      return {
        success: false,
        error: 'Proses pembuatan soal dengan AI sedang berjalan untuk ujian ini. Harap tunggu hingga selesai.',
        status: 409,
      };
    }
  }

  // 5. Create generation run record
  const runId = newId();
  const provider = getAiProvider(env);

  await db
    .prepare(
      `INSERT INTO cbt_ai_generation_runs (
        id, exam_id, event_id, actor_staff_id, provider, model, prompt_version,
        difficulty_mode, variation_level, topic, additional_instruction, reference_text,
        requested_count, generated_count, valid_count, rejected_count, status,
        idempotency_token, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'running', ?, ?)`
    )
    .bind(
      runId,
      examId,
      exam.event_id || null,
      actorStaffId,
      provider.name,
      provider.model,
      PROMPT_VERSION,
      difficultyMode,
      variationLevel,
      topic,
      additionalInstruction || null,
      referenceText || null,
      rawCount,
      idempotencyToken,
      now()
    )
    .run();

  // 6. Invoke AI Provider
  const generationInput: GenerationInput = {
    subject: exam.subject_name || exam.title || 'Mata Pelajaran Umum',
    targetGrade: exam.target_grade || null,
    examTitle: exam.title,
    domainContext: exam.mode || exam.event_mode || 'cbt',
    topic,
    additionalInstruction,
    referenceText,
    questionCount: rawCount,
    difficultyMode,
    variationLevel,
  };

  const providerResult = await provider.generateQuestions(generationInput);

  let questions = providerResult.questions;

  // If provider returned rawResponse but not parsed questions, parse safely
  if (providerResult.success && !questions && providerResult.rawResponse) {
    const parseResult = parseProviderJsonResponse(providerResult.rawResponse);
    if (!parseResult.success) {
      const errCode = 'MALFORMED_OUTPUT';
      const errMsg = parseResult.error || 'Gagal mem-parsing JSON dari AI';

      await db
        .prepare(
          `UPDATE cbt_ai_generation_runs
           SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?
           WHERE id = ?`
        )
        .bind(errCode, errMsg, now(), runId)
        .run();

      return {
        success: false,
        error: errMsg,
        status: 422,
        data: { runId, status: 'failed', errorCode: errCode },
      };
    }
    questions = parseResult.questions;
  }

  // 7. Handle Provider Failure
  if (!providerResult.success || !questions) {
    const errCode = providerResult.error?.code || 'PROVIDER_ERROR';
    const errMsg = providerResult.error?.message || 'Pembuatan soal AI gagal';

    await db
      .prepare(
        `UPDATE cbt_ai_generation_runs
         SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?
         WHERE id = ?`
      )
      .bind(errCode, errMsg, now(), runId)
      .run();

    return {
      success: false,
      error: errMsg,
      status: providerResult.error?.status || 500,
      data: { runId, status: 'failed', errorCode: errCode },
    };
  }

  // 8. Validate and Hash Each Generated Question
  const rawQuestions = questions;
  const existingExamHashes = await loadExistingExamQuestionHashes(db, examId);
  const currentRunHashes = new Set<string>();

  const draftInserts: Array<{
    id: string;
    run_id: string;
    exam_id: string;
    question_order: number;
    question_text: string;
    options_json: string;
    correct_index: number;
    explanation: string | null;
    difficulty: AiDifficultyMode;
    content_hash: string;
    validation_status: 'valid' | 'invalid' | 'duplicate';
    validation_errors_json: string | null;
    status: 'draft';
  }> = [];

  let validCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < rawQuestions.length; i++) {
    const rawQ = rawQuestions[i];
    const validation = validateRawQuestion(rawQ, i);

    const draftId = newId();
    const order = i + 1;

    if (!validation.isValid || !validation.normalized) {
      rejectedCount++;
      draftInserts.push({
        id: draftId,
        run_id: runId,
        exam_id: examId,
        question_order: order,
        question_text: typeof rawQ?.stem === 'string' ? rawQ.stem : `[Soal tidak valid #${order}]`,
        options_json: JSON.stringify(Array.isArray(rawQ?.options) ? rawQ.options : []),
        correct_index: Number.isInteger(rawQ?.correctIndex) ? rawQ.correctIndex : 0,
        explanation: typeof rawQ?.explanation === 'string' ? rawQ.explanation : null,
        difficulty: difficultyMode,
        content_hash: `invalid-${draftId}`,
        validation_status: 'invalid',
        validation_errors_json: JSON.stringify(validation.errors),
        status: 'draft',
      });
      continue;
    }

    const normQ = validation.normalized;
    const hash = await computeQuestionContentHash(normQ.stem, normQ.options);

    let valStatus: 'valid' | 'duplicate' = 'valid';
    const errors: string[] = [];

    // Duplicate check: within run
    if (currentRunHashes.has(hash)) {
      valStatus = 'duplicate';
      errors.push('Soal ini terdeteksi duplikat dengan soal lain dalam hasil generasi yang sama');
    }

    // Duplicate check: against target exam
    if (existingExamHashes.has(hash)) {
      valStatus = 'duplicate';
      errors.push('Soal ini terdeteksi duplikat dengan soal yang sudah ada di ujian ini');
    }

    currentRunHashes.add(hash);

    if (valStatus === 'valid') {
      validCount++;
    } else {
      rejectedCount++;
    }

    const optionsForStorage = normQ.options.map((opt, idx) => ({
      option_label: opt.label,
      option_text: opt.text,
      is_correct: idx === normQ.correctIndex ? 1 : 0,
    }));

    draftInserts.push({
      id: draftId,
      run_id: runId,
      exam_id: examId,
      question_order: order,
      question_text: normQ.stem,
      options_json: JSON.stringify(optionsForStorage),
      correct_index: normQ.correctIndex,
      explanation: normQ.explanation || null,
      difficulty: normQ.difficulty || difficultyMode,
      content_hash: hash,
      validation_status: valStatus,
      validation_errors_json: errors.length > 0 ? JSON.stringify(errors) : null,
      status: 'draft',
    });
  }

  // 9. Persist Drafts in D1
  const draftStatements: D1PreparedStatement[] = draftInserts.map((d) =>
    db
      .prepare(
        `INSERT INTO cbt_ai_question_drafts (
          id, run_id, exam_id, question_order, question_text, options_json,
          correct_index, explanation, difficulty, content_hash, validation_status,
          validation_errors_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .bind(
        d.id,
        d.run_id,
        d.exam_id,
        d.question_order,
        d.question_text,
        d.options_json,
        d.correct_index,
        d.explanation,
        d.difficulty,
        d.content_hash,
        d.validation_status,
        d.validation_errors_json,
        d.status
      )
  );

  for (let i = 0; i < draftStatements.length; i += 100) {
    await db.batch(draftStatements.slice(i, i + 100));
  }

  // 10. Update Run Status
  const finalStatus: 'completed' | 'partial' | 'failed' =
    validCount === rawCount ? 'completed' : validCount > 0 ? 'partial' : 'failed';

  await db
    .prepare(
      `UPDATE cbt_ai_generation_runs
       SET generated_count = ?, valid_count = ?, rejected_count = ?, status = ?, completed_at = ?
       WHERE id = ?`
    )
    .bind(rawQuestions.length, validCount, rejectedCount, finalStatus, now(), runId)
    .run();

  const drafts = await listAiDrafts(db, examId, runId);

  return {
    success: true,
    data: {
      runId,
      status: finalStatus,
      requestedCount: rawCount,
      generatedCount: rawQuestions.length,
      validCount,
      rejectedCount,
      drafts,
    },
    message:
      finalStatus === 'completed'
        ? `Berhasil membuat ${validCount} draf soal AI.`
        : `Pembuatan soal selesai secara parsial (${validCount} valid, ${rejectedCount} memiliki catatan).`,
  };
}

/**
 * Lists past generation runs for an exam.
 */
export async function listAiRuns(db: D1Database, examId: string) {
  const { results } = await db
    .prepare(
      `SELECT id, exam_id, actor_staff_id, provider, model, prompt_version,
              difficulty_mode, variation_level, topic, requested_count,
              generated_count, valid_count, rejected_count, status,
              error_code, error_message, created_at, completed_at
       FROM cbt_ai_generation_runs
       WHERE exam_id = ?
       ORDER BY created_at DESC`
    )
    .bind(examId)
    .all();

  return results || [];
}

/**
 * Lists question drafts for an exam (optionally filtered by run_id).
 */
export async function listAiDrafts(db: D1Database, examId: string, runId?: string) {
  let query = `SELECT * FROM cbt_ai_question_drafts WHERE exam_id = ?`;
  const params: any[] = [examId];

  if (runId) {
    query += ` AND run_id = ?`;
    params.push(runId);
  }

  query += ` ORDER BY question_order ASC`;

  const { results } = await db.prepare(query).bind(...params).all<any>();
  const rows = results || [];

  return rows.map((r) => {
    let options: any[] = [];
    try {
      options = JSON.parse(r.options_json);
    } catch {
      options = [];
    }

    let validationErrors: string[] = [];
    if (r.validation_errors_json) {
      try {
        validationErrors = JSON.parse(r.validation_errors_json);
      } catch {
        validationErrors = [r.validation_errors_json];
      }
    }

    return {
      ...r,
      options,
      validation_errors: validationErrors,
    };
  });
}

/**
 * Updates an existing draft question before acceptance.
 * Re-runs structural validation and duplicate detection.
 */
export async function updateAiDraft(
  db: D1Database,
  examId: string,
  draftId: string,
  updates: {
    question_text?: string;
    options?: any[];
    correct_index?: number;
    explanation?: string;
    difficulty?: string;
  }
) {
  // 1. Assert exam is mutable
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }

  // 2. Fetch existing draft
  const draft = await db
    .prepare('SELECT * FROM cbt_ai_question_drafts WHERE id = ? AND exam_id = ?')
    .bind(draftId, examId)
    .first<any>();

  if (!draft) {
    return { success: false, error: 'Draf soal tidak ditemukan', status: 404 };
  }

  if (draft.status === 'accepted') {
    return {
      success: false,
      error: 'Draf soal sudah diterima dan tidak dapat diubah lagi di authoring staging',
      status: 409,
    };
  }

  const existingOptions = JSON.parse(draft.options_json || '[]');
  const mergedStem = updates.question_text !== undefined ? updates.question_text : draft.question_text;
  const mergedOptions = updates.options !== undefined ? updates.options : existingOptions;
  const mergedCorrectIndex =
    updates.correct_index !== undefined ? updates.correct_index : draft.correct_index;
  const mergedExplanation =
    updates.explanation !== undefined ? updates.explanation : draft.explanation;
  const mergedDifficulty = updates.difficulty !== undefined ? updates.difficulty : draft.difficulty;

  // 3. Re-validate
  const validation = validateRawQuestion(
    {
      stem: mergedStem,
      options: mergedOptions,
      correctIndex: mergedCorrectIndex,
      explanation: mergedExplanation,
      difficulty: mergedDifficulty,
    },
    draft.question_order - 1
  );

  if (!validation.isValid || !validation.normalized) {
    return {
      success: false,
      error: validation.errors.join('; '),
      status: 400,
    };
  }

  const norm = validation.normalized;
  const newHash = await computeQuestionContentHash(norm.stem, norm.options);

  // Duplicate check against existing questions in exam
  const existingExamHashes = await loadExistingExamQuestionHashes(db, examId);
  let valStatus: 'valid' | 'duplicate' = 'valid';
  const errs: string[] = [];

  if (existingExamHashes.has(newHash)) {
    valStatus = 'duplicate';
    errs.push('Soal ini terdeteksi duplikat dengan soal yang sudah ada di ujian ini');
  }

  const optionsForStorage = norm.options.map((opt, idx) => ({
    option_label: opt.label,
    option_text: opt.text,
    is_correct: idx === norm.correctIndex ? 1 : 0,
  }));

  await db
    .prepare(
      `UPDATE cbt_ai_question_drafts
       SET question_text = ?, options_json = ?, correct_index = ?, explanation = ?,
           difficulty = ?, content_hash = ?, validation_status = ?, validation_errors_json = ?,
           updated_at = datetime('now')
       WHERE id = ? AND exam_id = ?`
    )
    .bind(
      norm.stem,
      JSON.stringify(optionsForStorage),
      norm.correctIndex,
      norm.explanation || null,
      norm.difficulty,
      newHash,
      valStatus,
      errs.length > 0 ? JSON.stringify(errs) : null,
      draftId,
      examId
    )
    .run();

  return { success: true, message: 'Draf soal diperbarui' };
}

/**
 * Deletes or rejects an AI draft.
 */
export async function deleteAiDraft(db: D1Database, examId: string, draftId: string) {
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }

  const draft = await db
    .prepare('SELECT id, status FROM cbt_ai_question_drafts WHERE id = ? AND exam_id = ?')
    .bind(draftId, examId)
    .first<any>();

  if (!draft) {
    return { success: false, error: 'Draf soal tidak ditemukan', status: 404 };
  }

  if (draft.status === 'accepted') {
    return {
      success: false,
      error: 'Draf soal sudah diterima ke dalam bank soal dan tidak dapat dihapus dari staging AI',
      status: 409,
    };
  }

  await db.prepare('DELETE FROM cbt_ai_question_drafts WHERE id = ?').bind(draftId).run();
  return { success: true, message: 'Draf soal dihapus' };
}

/**
 * Accepts selected valid drafts and atomically imports them into canonical questions.
 * Uses canonical createQuestion service.
 */
export async function acceptAiDrafts(db: D1Database, examId: string, draftIds: string[]) {
  // 1. Lifecycle verification
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }

  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    return { success: false, error: 'Pilih setidaknya satu draf soal untuk diimpor', status: 400 };
  }

  // 2. Fetch target drafts
  const placeholders = draftIds.map(() => '?').join(',');
  const { results: drafts } = await db
    .prepare(
      `SELECT * FROM cbt_ai_question_drafts
       WHERE exam_id = ? AND id IN (${placeholders})
       ORDER BY question_order ASC`
    )
    .bind(examId, ...draftIds)
    .all<any>();

  const draftList = drafts || [];
  if (draftList.length !== draftIds.length) {
    return {
      success: false,
      error: 'Sebagian draf soal yang dipilih tidak ditemukan pada ujian ini',
      status: 404,
    };
  }

  // 3. Validation checks
  for (const draft of draftList) {
    if (draft.status === 'accepted') {
      return {
        success: false,
        error: `Draf #${draft.question_order} sudah pernah diterima sebelumnya`,
        status: 409,
      };
    }
    if (draft.validation_status === 'invalid') {
      return {
        success: false,
        error: `Draf #${draft.question_order} memiliki status tidak valid dan belum dapat diterima`,
        status: 400,
      };
    }
  }

  // 4. Determine current canonical question count to continue ordering
  const countRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_questions WHERE exam_id = ?')
    .bind(examId)
    .first<any>();
  let currentOrder = Number(countRow?.cnt || 0);

  const acceptedQuestionIds: string[] = [];
  const allBatchStatements: D1PreparedStatement[] = [];

  // 5. Build atomic batch transaction: canonical questions, options, and draft status markers
  for (const draft of draftList) {
    currentOrder++;
    let options = [];
    try {
      options = JSON.parse(draft.options_json);
    } catch {
      options = [];
    }

    const payload = {
      question_text: draft.question_text,
      question_type: 'multiple_choice',
      question_order: currentOrder,
      points: 1,
      options: options.map((opt: any, idx: number) => ({
        option_label: opt.option_label || 'ABCDE'[idx] || String(idx + 1),
        option_text: opt.option_text || '',
        is_correct: opt.is_correct ? 1 : 0,
      })),
    };

    // Reuses the identical canonical question & option SQL preparation from questions.ts
    const { qId, statements } = prepareCanonicalQuestionStatements(db, examId, payload);
    allBatchStatements.push(...statements);
    acceptedQuestionIds.push(qId);

    // Atomic CAS marker: updates status to accepted with canonical_question_id in same transaction
    allBatchStatements.push(
      db.prepare(
        `UPDATE cbt_ai_question_drafts
         SET status = 'accepted', canonical_question_id = ?, updated_at = datetime('now')
         WHERE id = ? AND exam_id = ?`
      ).bind(qId, draft.id, examId)
    );
  }

  // Execute entire batch inside a single atomic D1 / SQLite transaction
  try {
    await db.batch(allBatchStatements);
  } catch (e: any) {
    return {
      success: false,
      error: `Gagal mengimpor draf soal secara atomik: ${e.message || String(e)}`,
      status: 409,
    };
  }

  return {
    success: true,
    data: {
      acceptedCount: acceptedQuestionIds.length,
      questionIds: acceptedQuestionIds,
    },
    message: `${acceptedQuestionIds.length} soal berhasil diterima dan diimpor ke bank soal ujian`,
  };
}
