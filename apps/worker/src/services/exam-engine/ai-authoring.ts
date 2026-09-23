// ============================================================
// AI Question Generator — Shared Authoring Service
// Interaction Pattern: Proven MANSATAS RPPM Generator
// Prompt generation, JSON parsing, normalization, duplicate detection,
// human review revalidation, and canonical question import.
// ============================================================

import type { Env, AiDifficultyMode, AiVariationLevel } from '../../types.ts';
import {
  buildQuestionGeneratorPrompt,
  computeDifficultyDistribution,
  PROMPT_VERSION,
  type PromptExamContext,
  type QuestionPromptConfig,
} from '../ai/prompt.ts';
import {
  validateRawQuestion,
  computeQuestionContentHash,
  parseRawQuestionsJson,
  normalizeAndValidatePastedQuestions,
  revalidateSingleQuestion,
  normalizeTextForHash,
  type ParsedQuestionItem,
} from '../ai/validator.ts';
import { prepareCanonicalQuestionStatements } from './questions.ts';
import { newId, now } from '../../utils/helpers.ts';

export const MAX_GENERATOR_QUESTIONS = 50;

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
export async function loadExistingExamQuestionHashes(db: D1Database, examId: string): Promise<Set<string>> {
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
 * Builds the high-quality, context-aware prompt for the teacher to copy to external AI.
 * Reuses the proven RPPM Generator pattern.
 */
export async function buildExamAiPrompt(
  db: D1Database,
  examId: string,
  config: {
    topic: string;
    question_count?: number;
    questionCount?: number;
    difficulty_mode?: AiDifficultyMode;
    difficultyMode?: AiDifficultyMode;
    variation_level?: AiVariationLevel;
    variationLevel?: AiVariationLevel;
    additional_instruction?: string;
    additionalInstruction?: string;
    reference_text?: string;
    referenceText?: string;
    reference_content?: string;
    referenceContent?: string;
    pattern_reference_enabled?: boolean;
    patternReferenceEnabled?: boolean;
  }
) {
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success || !examCheck.exam) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }
  const exam = examCheck.exam;

  const topic = (config.topic || '').trim();
  if (!topic) {
    return { success: false, error: 'Topik / materi pokok soal wajib diisi', status: 400 };
  }

  const questionCount = Number(config.question_count ?? config.questionCount ?? 5);
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > MAX_GENERATOR_QUESTIONS) {
    return {
      success: false,
      error: `Jumlah soal harus antara 1 hingga ${MAX_GENERATOR_QUESTIONS} butir`,
      status: 400,
    };
  }
  const difficultyMode = (config.difficulty_mode || config.difficultyMode || 'balanced') as AiDifficultyMode;
  const variationLevel = (config.variation_level || config.variationLevel || 'standard') as AiVariationLevel;
  const additionalInstruction = (config.additional_instruction || config.additionalInstruction || '').trim() || undefined;
  const referenceContent = (
    config.reference_content ||
    config.referenceContent ||
    config.reference_text ||
    config.referenceText ||
    ''
  ).trim() || undefined;
  const patternReferenceEnabled = Boolean(
    config.pattern_reference_enabled ?? config.patternReferenceEnabled ?? false
  );

  const examContext: PromptExamContext = {
    examTitle: exam.title || 'Ujian CBT',
    subjectName: exam.subject_name || exam.title || 'Mata Pelajaran Umum',
    targetGrade: exam.target_grade || null,
    mode: exam.mode || exam.event_mode || 'cbt',
    eventName: exam.event_name || null,
  };

  const promptConfig: QuestionPromptConfig = {
    topic,
    questionCount,
    difficultyMode,
    variationLevel,
    additionalInstruction,
    referenceContent,
    patternReferenceEnabled,
  };

  const prompt = buildQuestionGeneratorPrompt(promptConfig, examContext);

  return {
    success: true,
    data: {
      prompt,
      context: examContext,
      config: promptConfig,
    },
  };
}

/**
 * Parses and validates raw JSON input pasted by the teacher from an external AI.
 * Computes content hashes and detects duplicates within the batch and against target exam.
 */
export async function validatePastedAiQuestions(
  db: D1Database,
  examId: string,
  input: {
    raw_json?: string;
    rawJson?: string;
    questions?: any[];
  }
) {
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }

  let rawQuestions: any[] | undefined = input.questions;

  const rawJsonText = input.raw_json || input.rawJson;
  if (!rawQuestions && typeof rawJsonText === 'string') {
    const parsed = parseRawQuestionsJson(rawJsonText);
    if (!parsed.success || !parsed.questions) {
      return {
        success: false,
        error: parsed.error || 'Gagal mem-parsing teks JSON dari AI.',
        status: 400,
      };
    }
    rawQuestions = parsed.questions;
  }

  if (!rawQuestions || !Array.isArray(rawQuestions)) {
    return {
      success: false,
      error: 'Data pertanyaan tidak ditemukan atau format bukan array.',
      status: 400,
    };
  }

  if (rawQuestions.length === 0) {
    return {
      success: false,
      error: 'Array pertanyaan kosong.',
      status: 400,
    };
  }

  if (rawQuestions.length > MAX_GENERATOR_QUESTIONS) {
    return {
      success: false,
      error: `Jumlah soal (${rawQuestions.length}) melebihi batas maksimal ${MAX_GENERATOR_QUESTIONS} butir per workflow.`,
      status: 400,
    };
  }

  const existingExamHashes = await loadExistingExamQuestionHashes(db, examId);
  const result = await normalizeAndValidatePastedQuestions(rawQuestions, existingExamHashes);

  return {
    success: true,
    data: result,
  };
}

/**
 * Re-validates a single question edited by the teacher in the review stage.
 */
export async function revalidateEditedAiQuestion(
  db: D1Database,
  examId: string,
  input: {
    question: ParsedQuestionItem;
    all_other_questions?: ParsedQuestionItem[];
    allOtherQuestions?: ParsedQuestionItem[];
  }
) {
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }

  if (!input.question) {
    return { success: false, error: 'Data soal wajib diisi', status: 400 };
  }

  const existingExamHashes = await loadExistingExamQuestionHashes(db, examId);
  const allOther = input.all_other_questions || input.allOtherQuestions || [];
  const revalidated = await revalidateSingleQuestion(input.question, allOther, existingExamHashes);

  return {
    success: true,
    data: { question: revalidated },
  };
}

/**
 * Atomically imports validated and reviewed questions into canonical CBT questions.
 * Enforces authoritative server validation, duplicate rejection, and sequential ordering.
 */
export async function importReviewedAiQuestions(
  db: D1Database,
  examId: string,
  questions: any[]
) {
  // 1. Lifecycle verification
  const examCheck = await assertExamMutableForAi(db, examId);
  if (!examCheck.success) {
    return { success: false, error: examCheck.error, status: examCheck.status };
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      success: false,
      error: 'Pilih setidaknya satu butir soal untuk diimpor ke ujian',
      status: 400,
    };
  }

  if (questions.length > MAX_GENERATOR_QUESTIONS) {
    return {
      success: false,
      error: `Jumlah soal (${questions.length}) melebihi batas maksimal ${MAX_GENERATOR_QUESTIONS} butir per workflow`,
      status: 400,
    };
  }

  // 2. Authoritative server validation for every single question
  const existingExamHashes = await loadExistingExamQuestionHashes(db, examId);
  const batchHashes = new Set<string>();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const validation = validateRawQuestion(q, i);

    if (!validation.isValid || !validation.normalized) {
      return {
        success: false,
        error: `Validasi gagal pada soal #${i + 1}: ${validation.errors.join('; ')}`,
        status: 400,
      };
    }

    const norm = validation.normalized;
    const hash = await computeQuestionContentHash(norm.stem, norm.options);

    if (batchHashes.has(hash)) {
      return {
        success: false,
        error: `Terdapat soal duplikat di dalam daftar impor pada soal #${i + 1}`,
        status: 400,
      };
    }

    if (existingExamHashes.has(hash)) {
      return {
        success: false,
        error: `Soal #${i + 1} sudah ada di dalam bank soal ujian ini (duplikat terdeteksi)`,
        status: 409,
      };
    }

    batchHashes.add(hash);
  }

  // 3. Determine current question count to maintain sequential question_order
  const countRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_questions WHERE exam_id = ?')
    .bind(examId)
    .first<any>();
  let currentOrder = Number(countRow?.cnt || 0);

  const acceptedQuestionIds: string[] = [];
  const allBatchStatements: D1PreparedStatement[] = [];

  // 4. Build atomic batch statements using canonical prepareCanonicalQuestionStatements
  for (const q of questions) {
    currentOrder++;
    const validation = validateRawQuestion(q);
    const norm = validation.normalized!;

    const payload = {
      question_text: norm.stem,
      question_type: 'multiple_choice',
      question_order: currentOrder,
      points: 1,
      options: norm.options.map((opt, idx) => ({
        option_label: opt.label || 'ABCDE'[idx] || String(idx + 1),
        option_text: opt.text || '',
        is_correct: idx === norm.correctIndex ? 1 : 0,
      })),
    };

    const { qId, statements } = prepareCanonicalQuestionStatements(db, examId, payload);
    allBatchStatements.push(...statements);
    acceptedQuestionIds.push(qId);
  }

  // 5. Execute all statements in ONE atomic db.batch() transaction.
  // Each individual prepared statement uses only 7–8 bound parameters (well within D1's per-query limit).
  // A single db.batch() call provides the atomic transaction boundary: either all selected questions
  // and options succeed, or zero rows are committed.
  try {
    await db.batch(allBatchStatements);
  } catch (e: any) {
    return {
      success: false,
      error: `Gagal mengimpor butir soal: ${e.message || String(e)}`,
      status: 409,
    };
  }

  return {
    success: true,
    data: {
      acceptedCount: acceptedQuestionIds.length,
      questionIds: acceptedQuestionIds,
    },
    message: `${acceptedQuestionIds.length} butir soal berhasil diimpor ke bank soal ujian`,
  };
}

// ══════════════════════════════════════════════════════════════
// Legacy Compatibility Functions (preserves DB schema compatibility)
// ══════════════════════════════════════════════════════════════

export async function listAiRuns(db: D1Database, examId: string) {
  try {
    const { results } = await db
      .prepare('SELECT * FROM cbt_ai_generation_runs WHERE exam_id = ? ORDER BY created_at DESC')
      .bind(examId)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

export async function listAiDrafts(db: D1Database, examId: string, runId?: string) {
  try {
    let query = `SELECT * FROM cbt_ai_question_drafts WHERE exam_id = ?`;
    const params: any[] = [examId];
    if (runId) {
      query += ` AND run_id = ?`;
      params.push(runId);
    }
    query += ` ORDER BY question_order ASC`;
    const { results } = await db.prepare(query).bind(...params).all<any>();
    return (results || []).map((r) => {
      let options = [];
      try {
        options = JSON.parse(r.options_json);
      } catch {
        options = [];
      }
      return { ...r, options };
    });
  } catch {
    return [];
  }
}

export async function updateAiDraft(
  db: D1Database,
  examId: string,
  draftId: string,
  updates: any
): Promise<{ success: boolean; error?: string; status?: number; message?: string }> {
  return { success: true, message: 'Draf diperbarui (legacy compatibility)' };
}

export async function deleteAiDraft(
  db: D1Database,
  examId: string,
  draftId: string
): Promise<{ success: boolean; error?: string; status?: number; message?: string }> {
  try {
    await db.prepare('DELETE FROM cbt_ai_question_drafts WHERE id = ?').bind(draftId).run();
  } catch {}
  return { success: true, message: 'Draf dihapus' };
}

export async function acceptAiDrafts(
  db: D1Database,
  examId: string,
  draftIds: string[]
): Promise<{ success: boolean; error?: string; status?: number; data?: any; message?: string }> {
  // If draftIds provided, query drafts and forward to importReviewedAiQuestions
  const placeholders = draftIds.map(() => '?').join(',');
  const { results: drafts } = await db
    .prepare(
      `SELECT * FROM cbt_ai_question_drafts WHERE exam_id = ? AND id IN (${placeholders})`
    )
    .bind(examId, ...draftIds)
    .all<any>();

  if (!drafts || drafts.length === 0) {
    return { success: false, error: 'Draf tidak ditemukan', status: 404 };
  }

  const questions = drafts.map((d) => ({
    stem: d.question_text,
    options: JSON.parse(d.options_json || '[]'),
    correctIndex: d.correct_index,
    difficulty: d.difficulty,
    explanation: d.explanation,
  }));

  return importReviewedAiQuestions(db, examId, questions);
}

export async function generateAiQuestions(
  db: D1Database,
  env: Env,
  examId: string,
  actorStaffId: string,
  input: any
): Promise<{ success: boolean; error?: string; status?: number; data?: any; message?: string }> {
  // If input contains questions, forward to validation
  if (input.questions || input.raw_json) {
    const res = await validatePastedAiQuestions(db, examId, input);
    return { ...res, message: res.success ? 'Soal berhasil divalidasi' : undefined };
  }

  // Otherwise generate prompt
  const res = await buildExamAiPrompt(db, examId, input);
  return { ...res, message: res.success ? 'Prompt berhasil disusun' : undefined };
}
