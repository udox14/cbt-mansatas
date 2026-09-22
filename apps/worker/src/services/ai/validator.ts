// ============================================================
// AI Question Generator — Validator & Duplicate Detection
// ============================================================

import type { RawGeneratedQuestion, RawGeneratedOption } from './types.ts';
import type { AiDifficultyMode } from '../../types.ts';

export interface QuestionValidationResult {
  isValid: boolean;
  errors: string[];
  normalized?: RawGeneratedQuestion;
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
  options: Array<{ text: string }>
): Promise<string> {
  const normStem = normalizeTextForHash(stem);
  const normOptions = options
    .map((o) => normalizeTextForHash(o.text))
    .sort()
    .join('||');

  const payload = `${normStem}::${normOptions}`;
  const buffer = new TextEncoder().encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates a single generated question against strict structural requirements.
 */
export function validateRawQuestion(q: any, index = 0): QuestionValidationResult {
  const errors: string[] = [];

  if (!q || typeof q !== 'object') {
    return { isValid: false, errors: [`Soal #${index + 1}: Data soal bukan objek yang valid`] };
  }

  // 1. Stem validation
  const stem = typeof q.stem === 'string' ? q.stem.trim() : '';
  if (!stem) {
    errors.push(`Soal #${index + 1}: Teks pokok soal (stem) tidak boleh kosong`);
  } else if (stem.length > 10000) {
    errors.push(`Soal #${index + 1}: Teks pokok soal melebihi batas 10.000 karakter`);
  }

  // 2. Options array validation
  if (!Array.isArray(q.options)) {
    errors.push(`Soal #${index + 1}: Pilihan jawaban harus berupa array`);
    return { isValid: false, errors };
  }

  if (q.options.length < 3 || q.options.length > 5) {
    errors.push(
      `Soal #${index + 1}: Jumlah pilihan jawaban (${q.options.length}) tidak valid. Wajib antara 3 hingga 5 pilihan.`
    );
  }

  const normalizedOptions: RawGeneratedOption[] = [];
  const seenOptionTexts = new Set<string>();

  for (let optIdx = 0; optIdx < q.options.length; optIdx++) {
    const rawOpt = q.options[optIdx];
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
  let correctIndex = Number(q.correctIndex !== undefined ? q.correctIndex : q.correct_index);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= q.options.length) {
    // Check if options have is_correct flag
    const flagIdx = q.options.findIndex((o: any) => o && (o.is_correct === 1 || o.is_correct === true));
    if (flagIdx >= 0) {
      correctIndex = flagIdx;
    } else {
      errors.push(
        `Soal #${index + 1}: Kunci jawaban tidak valid (index: ${q.correctIndex ?? q.correct_index}). Wajib menunjuk ke opsi yang ada (0 sampai ${q.options.length - 1}).`
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
 * Safely parses raw JSON output from the AI provider,
 * stripping markdown code fences if present.
 */
export function parseProviderJsonResponse(raw: string): {
  success: boolean;
  questions?: any[];
  error?: string;
} {
  if (!raw || typeof raw !== 'string') {
    return { success: false, error: 'Respons dari provider kosong atau bukan string' };
  }

  let cleaned = raw.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
    cleaned = cleaned.trim();
  }

  try {
    const parsed = JSON.parse(cleaned);

    let questions: any[] | undefined;
    if (Array.isArray(parsed)) {
      questions = parsed;
    } else if (parsed && Array.isArray(parsed.questions)) {
      questions = parsed.questions;
    } else if (parsed && Array.isArray(parsed.data)) {
      questions = parsed.data;
    }

    if (!questions) {
      return {
        success: false,
        error: 'Struktur JSON tidak memuat array "questions"',
      };
    }

    return { success: true, questions };
  } catch (e: any) {
    return {
      success: false,
      error: `Gagal mem-parsing JSON dari AI: ${e.message || String(e)}`,
    };
  }
}
