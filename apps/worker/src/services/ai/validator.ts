// ============================================================
// AI Question Generator — Validator & Duplicate Detection
// Interaction Pattern: Proven MANSATAS RPPM Generator
// Normalization, structural schema validation, duplicate detection
// and deterministic revalidation after editing.
// ============================================================

import type { AiDifficultyMode } from '../../types.ts';
import type { RawGeneratedQuestion, RawGeneratedOption } from './types.ts';

export interface QuestionValidationResult {
  isValid: boolean;
  errors: string[];
  normalized?: RawGeneratedQuestion;
}

export interface ParsedOptionItem {
  option_label: string;
  option_text: string;
  is_correct: number;
}

export interface ParsedQuestionItem {
  id: string;
  stem: string;
  options: ParsedOptionItem[];
  correct_index: number;
  explanation?: string | null;
  difficulty: AiDifficultyMode;
  content_hash: string;
  validation_status: 'valid' | 'invalid' | 'duplicate';
  validation_errors: string[];
}

/**
 * Normalizes text for deterministic duplicate hashing.
 * Preserves Arabic characters, diacritics, and math symbols.
 * Strips HTML tags, collapses whitespace, applies NFKC normalization, and lowercases.
 */
export function normalizeTextForHash(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(/<[^>]+>/g, ' ') // Strip HTML tags
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim()
    .toLowerCase();
}

/**
 * Computes a deterministic SHA-256 content hash for a question.
 */
export async function computeQuestionContentHash(
  stem: string,
  options: Array<{ text?: string; option_text?: string }>
): Promise<string> {
  const normStem = normalizeTextForHash(stem);
  const normOptions = options
    .map((o) => normalizeTextForHash(o.text || o.option_text || ''))
    .sort()
    .join('||');

  const payload = `${normStem}::${normOptions}`;
  const buffer = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```) and leading/trailing whitespace.
 */
export function stripJsonFence(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
    cleaned = cleaned.trim();
  }
  return cleaned;
}

/**
 * Parses raw JSON string into an array of question objects.
 * Tolerates ```json code fences and common root wrapper structures.
 */
export function parseRawQuestionsJson(raw: string): {
  success: boolean;
  questions?: any[];
  error?: string;
} {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return { success: false, error: 'Teks JSON yang dipaste kosong.' };
  }

  const cleaned = stripJsonFence(raw);

  try {
    const parsed = JSON.parse(cleaned);

    let questions: any[] | undefined;
    if (Array.isArray(parsed)) {
      questions = parsed;
    } else if (parsed && Array.isArray(parsed.questions)) {
      questions = parsed.questions;
    } else if (parsed && Array.isArray(parsed.data)) {
      questions = parsed.data;
    } else if (parsed && Array.isArray(parsed.soal)) {
      questions = parsed.soal;
    }

    if (!questions) {
      return {
        success: false,
        error: 'Struktur JSON tidak memuat array "questions". Pastikan format sesuai skema.',
      };
    }

    return { success: true, questions };
  } catch (e: any) {
    return {
      success: false,
      error: `Format JSON tidak valid: ${e.message || String(e)}`,
    };
  }
}

/**
 * Validates a single question object against strict CBT rules.
 */
export function validateRawQuestion(q: any, index = 0): QuestionValidationResult {
  const errors: string[] = [];

  if (!q || typeof q !== 'object') {
    return { isValid: false, errors: [`Soal #${index + 1}: Data soal bukan objek yang valid`] };
  }

  // 1. Stem validation
  const stem = typeof q.stem === 'string'
    ? q.stem.trim()
    : typeof q.question_text === 'string'
    ? q.question_text.trim()
    : '';

  if (!stem) {
    errors.push(`Soal #${index + 1}: Teks pokok soal (stem) tidak boleh kosong`);
  } else if (stem.length > 10000) {
    errors.push(`Soal #${index + 1}: Teks pokok soal melebihi batas 10.000 karakter`);
  }

  // 2. Options array validation
  const rawOptions = Array.isArray(q.options) ? q.options : null;
  if (!rawOptions) {
    errors.push(`Soal #${index + 1}: Pilihan jawaban harus berupa array`);
    return { isValid: false, errors };
  }

  if (rawOptions.length < 3 || rawOptions.length > 5) {
    errors.push(
      `Soal #${index + 1}: Jumlah pilihan jawaban (${rawOptions.length}) tidak valid. Wajib antara 3 hingga 5 pilihan.`
    );
  }

  const normalizedOptions: RawGeneratedOption[] = [];
  const seenOptionTexts = new Set<string>();

  for (let optIdx = 0; optIdx < rawOptions.length; optIdx++) {
    const rawOpt = rawOptions[optIdx];
    const defaultLabel = 'ABCDE'[optIdx] || String(optIdx + 1);

    let optText = '';
    let optLabel = defaultLabel;

    if (typeof rawOpt === 'string') {
      optText = rawOpt.trim();
    } else if (rawOpt && typeof rawOpt === 'object') {
      optText = typeof rawOpt.text === 'string'
        ? rawOpt.text.trim()
        : typeof rawOpt.option_text === 'string'
        ? rawOpt.option_text.trim()
        : '';
      if (typeof rawOpt.label === 'string' && rawOpt.label.trim()) {
        optLabel = rawOpt.label.trim().toUpperCase();
      } else if (typeof rawOpt.option_label === 'string' && rawOpt.option_label.trim()) {
        optLabel = rawOpt.option_label.trim().toUpperCase();
      }
    }

    if (!optText) {
      errors.push(`Soal #${index + 1}: Pilihan ${optLabel} tidak boleh kosong`);
    } else if (optText.length > 2000) {
      errors.push(`Soal #${index + 1}: Pilihan ${optLabel} melebihi batas 2.000 karakter`);
    }

    // Check for duplicate options within the same question
    const normalizedText = normalizeTextForHash(optText);
    if (normalizedText) {
      if (seenOptionTexts.has(normalizedText)) {
        errors.push(`Soal #${index + 1}: Terdapat pilihan jawaban duplikat ("${optText}")`);
      }
      seenOptionTexts.add(normalizedText);
    }

    normalizedOptions.push({
      label: optLabel,
      text: optText,
    });
  }

  // 3. Correct index validation
  let correctIndex: number = -1;
  if (q.correctIndex !== undefined && q.correctIndex !== null) {
    correctIndex = Number(q.correctIndex);
  } else if (q.correct_index !== undefined && q.correct_index !== null) {
    correctIndex = Number(q.correct_index);
  } else {
    // Check if options have is_correct flag
    const flagIdx = rawOptions.findIndex((o: any) => o && (o.is_correct === 1 || o.is_correct === true));
    if (flagIdx >= 0) {
      correctIndex = flagIdx;
    }
  }

  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= rawOptions.length) {
    // Fallback: check is_correct flag if not already tried
    const flagIdx = rawOptions.findIndex((o: any) => o && (o.is_correct === 1 || o.is_correct === true));
    if (flagIdx >= 0) {
      correctIndex = flagIdx;
    } else {
      errors.push(
        `Soal #${index + 1}: Kunci jawaban tidak valid (index: ${q.correctIndex ?? q.correct_index}). Wajib menunjuk ke opsi yang ada (0 sampai ${rawOptions.length - 1}).`
      );
    }
  }

  // 4. Difficulty validation
  const rawDiff = String(q.difficulty || 'balanced').toLowerCase();
  const validDifficulties: AiDifficultyMode[] = ['easy', 'balanced', 'hard'];
  const difficulty: AiDifficultyMode = validDifficulties.includes(rawDiff as any)
    ? (rawDiff as AiDifficultyMode)
    : 'balanced';

  // 5. Explanation validation
  const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : undefined;

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: [],
    normalized: {
      stem,
      options: normalizedOptions,
      correctIndex,
      explanation,
      difficulty,
    },
  };
}

/**
 * Normalizes, validates, and checks duplicates for a batch of raw parsed questions.
 */
export async function normalizeAndValidatePastedQuestions(
  rawQuestions: any[],
  existingExamHashes?: Set<string>
): Promise<{
  questions: ParsedQuestionItem[];
  stats: { total: number; valid: number; duplicate: number; invalid: number };
}> {
  const items: ParsedQuestionItem[] = [];
  const currentBatchHashes = new Set<string>();

  let valid = 0;
  let duplicate = 0;
  let invalid = 0;

  for (let i = 0; i < rawQuestions.length; i++) {
    const rawQ = rawQuestions[i];
    const validation = validateRawQuestion(rawQ, i);
    const tempId = `ai-item-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;

    if (!validation.isValid || !validation.normalized) {
      invalid++;
      const rawOptions = Array.isArray(rawQ?.options) ? rawQ.options : [];
      items.push({
        id: tempId,
        stem: typeof rawQ?.stem === 'string' ? rawQ.stem : (typeof rawQ?.question_text === 'string' ? rawQ.question_text : ''),
        options: rawOptions.map((o: any, idx: number) => ({
          option_label: o?.label || o?.option_label || 'ABCDE'[idx] || String(idx + 1),
          option_text: typeof o === 'string' ? o : (o?.text || o?.option_text || ''),
          is_correct: idx === 0 ? 1 : 0,
        })),
        correct_index: 0,
        explanation: typeof rawQ?.explanation === 'string' ? rawQ.explanation : null,
        difficulty: 'balanced',
        content_hash: `invalid-${tempId}`,
        validation_status: 'invalid',
        validation_errors: validation.errors,
      });
      continue;
    }

    const norm = validation.normalized;
    const hash = await computeQuestionContentHash(norm.stem, norm.options);

    let valStatus: 'valid' | 'duplicate' = 'valid';
    const errors: string[] = [];

    // Duplicate check: within current pasted batch
    if (currentBatchHashes.has(hash)) {
      valStatus = 'duplicate';
      errors.push('Soal ini duplikat dengan soal lain dalam hasil paste yang sama');
    }

    // Duplicate check: against existing exam questions
    if (existingExamHashes && existingExamHashes.has(hash)) {
      valStatus = 'duplicate';
      errors.push('Soal ini sudah ada di dalam bank soal ujian ini');
    }

    currentBatchHashes.add(hash);

    if (valStatus === 'valid') {
      valid++;
    } else {
      duplicate++;
    }

    const optionsForStorage: ParsedOptionItem[] = norm.options.map((opt, idx) => ({
      option_label: opt.label,
      option_text: opt.text,
      is_correct: idx === norm.correctIndex ? 1 : 0,
    }));

    items.push({
      id: tempId,
      stem: norm.stem,
      options: optionsForStorage,
      correct_index: norm.correctIndex,
      explanation: norm.explanation || null,
      difficulty: norm.difficulty || 'balanced',
      content_hash: hash,
      validation_status: valStatus,
      validation_errors: errors,
    });
  }

  return {
    questions: items,
    stats: {
      total: rawQuestions.length,
      valid,
      duplicate,
      invalid,
    },
  };
}

/**
 * Authoritative re-validation of a single question item after human editing.
 * Recomputes content hash and re-verifies duplicate and validity status.
 */
export async function revalidateSingleQuestion(
  edited: ParsedQuestionItem,
  allOtherItems: ParsedQuestionItem[],
  existingExamHashes?: Set<string>
): Promise<ParsedQuestionItem> {
  const validation = validateRawQuestion(
    {
      stem: edited.stem,
      options: edited.options,
      correctIndex: edited.correct_index,
      explanation: edited.explanation,
      difficulty: edited.difficulty,
    },
    0
  );

  if (!validation.isValid || !validation.normalized) {
    return {
      ...edited,
      validation_status: 'invalid',
      validation_errors: validation.errors,
      content_hash: `invalid-${edited.id}`,
    };
  }

  const norm = validation.normalized;
  const hash = await computeQuestionContentHash(norm.stem, norm.options);

  let valStatus: 'valid' | 'duplicate' = 'valid';
  const errors: string[] = [];

  // Check if hash collides with any OTHER item in the current batch
  const otherHashes = new Set(
    allOtherItems
      .filter((o) => o.id !== edited.id && o.validation_status !== 'invalid')
      .map((o) => o.content_hash)
  );

  if (otherHashes.has(hash)) {
    valStatus = 'duplicate';
    errors.push('Soal ini duplikat dengan soal lain dalam daftar telaah');
  }

  // Check against existing exam questions
  if (existingExamHashes && existingExamHashes.has(hash)) {
    valStatus = 'duplicate';
    errors.push('Soal ini sudah ada di dalam bank soal ujian ini');
  }

  const optionsForStorage: ParsedOptionItem[] = norm.options.map((opt, idx) => ({
    option_label: opt.label,
    option_text: opt.text,
    is_correct: idx === norm.correctIndex ? 1 : 0,
  }));

  return {
    id: edited.id,
    stem: norm.stem,
    options: optionsForStorage,
    correct_index: norm.correctIndex,
    explanation: norm.explanation || null,
    difficulty: norm.difficulty || 'balanced',
    content_hash: hash,
    validation_status: valStatus,
    validation_errors: errors,
  };
}

/**
 * Legacy compatibility alias for existing callers/tests.
 */
export function parseProviderJsonResponse(raw: string): {
  success: boolean;
  questions?: any[];
  error?: string;
} {
  return parseRawQuestionsJson(raw);
}
