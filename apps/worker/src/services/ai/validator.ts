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
 * Boilerplate lead-in phrases that LLMs commonly generate for reading/dialogue questions.
 * Stripping or transforming these prevents monotonous, repetitive opening sentences across questions.
 */
export const BOILERPLATE_PREFIX_REGEX = /^\s*(?:Read the following (?:passage|poem|dialogue|text|conversation|story|excerpt) carefully,?\s*(?:then|and)?\s*answer the questions?\s*(?:below|that follow)?\.?\s*|Bacalah (?:teks|paragraf|wacana|kutipan|dialog|puisi|bacaan) berikut (?:ini )?(?:dengan (?:saksama|seksama|teliti))?,?\s*(?:kemudian|lalu)?\s*(?:jawablah|jawab)?\s*(?:pertanyaan|soal)?\s*(?:di bawah ini|berikut)?(?: nomor \d+)?[\.:]?\s*|Perhatikan (?:teks|paragraf|wacana|kutipan|dialog|puisi|pernyataan|tabel|potongan dialog) berikut (?:ini)?[\.:]?\s*)/i;

/**
 * Normalizes question stem text into clean, structured semantic HTML.
 * Handles dialogues, poems, multi-paragraph text, and strips repetitive boilerplate lead-ins.
 * Preserves LaTeX formulas, Arabic scripts, and existing valid HTML structures.
 */
export function formatQuestionStemHtml(rawStem: string): string {
  if (!rawStem || typeof rawStem !== 'string') return '';
  let text = rawStem.trim();

  // 1. If text has a repetitive boilerplate lead-in, remove it if something substantive remains
  const cleanLead = text.replace(BOILERPLATE_PREFIX_REGEX, '').trim();
  if (cleanLead.length > 5) {
    text = cleanLead;
  }

  // 2. If already rich HTML with dialogue, poem, or block containers, return trimmed text
  if (
    text.includes('class="cbt-dialogue"') ||
    text.includes('class="cbt-poem"') ||
    text.includes('class="cbt-stimulus-box"')
  ) {
    return text;
  }

  // If text already contains block tags like <p>, <div>, <table>, <ul>, don't re-wrap paragraphs
  const hasBlockHtml = /<(?:p|div|table|ul|ol|blockquote)\b/i.test(text);

  // 3. Check for dialogue structure: lines matching Speaker: Speech
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const speakerRegex = /^([A-Z\u0600-\u06FF][A-Za-z\u0600-\u06FF0-9\s'.-]{0,25}):\s*(.+)$/;

  const dialogueLineIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (speakerRegex.test(line)) {
      dialogueLineIndices.push(idx);
    }
  });

  // If there are 2 or more speaker turns, structure as dialogue
  if (dialogueLineIndices.length >= 2) {
    const firstDiagIdx = dialogueLineIndices[0];
    const lastDiagIdx = dialogueLineIndices[dialogueLineIndices.length - 1];

    // Any stage directions or scene headers immediately preceding the dialogue
    let preDialogueStart = firstDiagIdx;
    while (preDialogueStart > 0) {
      const prevLine = lines[preDialogueStart - 1];
      if (
        /^(?:scene|babak|adegan|latar)\b/i.test(prevLine) ||
        /^\(.*\)$/.test(prevLine) ||
        /^\[.*\]$/.test(prevLine)
      ) {
        preDialogueStart--;
      } else {
        break;
      }
    }

    const preDialogue = lines.slice(0, preDialogueStart);
    const dialogueSection = lines.slice(preDialogueStart, lastDiagIdx + 1);
    const postDialogue = lines.slice(lastDiagIdx + 1);

    const dialogueHtmlLines: string[] = [];
    for (const dLine of dialogueSection) {
      const match = dLine.match(speakerRegex);
      if (match) {
        dialogueHtmlLines.push(`<p><strong>${match[1]}:</strong> ${match[2]}</p>`);
      } else if (/^\(.*\)$/.test(dLine) || /^\[.*\]$/.test(dLine)) {
        dialogueHtmlLines.push(`<p class="cbt-dialogue-direction"><em>${dLine}</em></p>`);
      } else if (/^(?:scene|babak|adegan)\b/i.test(dLine)) {
        dialogueHtmlLines.push(`<p class="cbt-dialogue-scene"><strong>${dLine}</strong></p>`);
      } else {
        dialogueHtmlLines.push(`<p>${dLine}</p>`);
      }
    }

    const parts: string[] = [];
    if (preDialogue.length > 0) {
      parts.push(preDialogue.map((l) => `<p>${l}</p>`).join(''));
    }
    parts.push(`<div class="cbt-dialogue">${dialogueHtmlLines.join('')}</div>`);
    if (postDialogue.length > 0) {
      parts.push(postDialogue.map((l) => `<p>${l}</p>`).join(''));
    }

    return parts.join('');
  }

  // If already has block HTML and wasn't a plain-text dialogue, return text
  if (hasBlockHtml) {
    return text;
  }

  // 4. Check for poetry structure: 3+ consecutive short lines (< 80 chars) ending without ?
  if (lines.length >= 4) {
    const lastLineIsQuestion = lines[lines.length - 1].endsWith('?');
    const poemCandidateLines = lastLineIsQuestion ? lines.slice(0, -1) : lines;
    const allShort = poemCandidateLines.every((l) => l.length < 80);

    if (allShort && poemCandidateLines.length >= 3) {
      const poemBody = `<div class="cbt-poem"><p>${poemCandidateLines.join('<br/>')}</p></div>`;
      if (lastLineIsQuestion) {
        return `${poemBody}<p>${lines[lines.length - 1]}</p>`;
      }
      return poemBody;
    }
  }

  // 5. If plain text with newlines (\n\n or \n), convert to clean paragraphs
  if (text.includes('\n')) {
    const paragraphs = text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length > 1) {
      return paragraphs.map((p) => `<p>${p.replace(/\r?\n/g, '<br/>')}</p>`).join('');
    }
    return `<p>${text.replace(/\r?\n/g, '<br/>')}</p>`;
  }

  // Single line / simple question: return trimmed as is
  return text;
}

/**
 * Detects whether 3 or more questions in a batch start with the exact same prefix words.
 * Returns map of question index to descriptive quality warning message.
 */
export function detectRepetitiveStemPrefixes(stems: string[]): Map<number, string> {
  const warnings = new Map<number, string>();
  if (stems.length < 3) return warnings;

  // Extract first 4 significant words of each stem
  const prefixMap = new Map<string, number[]>();

  stems.forEach((rawStem, idx) => {
    const plain = rawStem
      .normalize('NFKC')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\w\s\u0600-\u06FF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const words = plain.split(' ').slice(0, 4).join(' ');
    if (words.length >= 10) {
      if (!prefixMap.has(words)) {
        prefixMap.set(words, []);
      }
      prefixMap.get(words)!.push(idx);
    }
  });

  for (const [prefix, indices] of prefixMap.entries()) {
    if (indices.length >= 3) {
      const msg = `Peringatan Variasi: Soal ini memiliki kalimat pembuka yang seragam dengan ${indices.length - 1} butir soal lain ("${prefix}..."). Disarankan menyunting pokok soal agar lebih bervariasi.`;
      for (const idx of indices) {
        warnings.set(idx, msg);
      }
    }
  }

  return warnings;
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
  const rawStem = typeof q.stem === 'string'
    ? q.stem.trim()
    : typeof q.question_text === 'string'
    ? q.question_text.trim()
    : '';

  if (!rawStem) {
    errors.push(`Soal #${index + 1}: Teks pokok soal (stem) tidak boleh kosong`);
  } else if (rawStem.length > 10000) {
    errors.push(`Soal #${index + 1}: Teks pokok soal melebihi batas 10.000 karakter`);
  }

  const stem = formatQuestionStemHtml(rawStem);

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

  // Detect repetitive boilerplate stem prefixes across the batch
  const prefixWarnings = detectRepetitiveStemPrefixes(items.map((it) => it.stem));
  for (const [idx, warningMsg] of prefixWarnings.entries()) {
    if (items[idx] && items[idx].validation_status === 'valid') {
      items[idx].validation_errors.push(warningMsg);
    }
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
