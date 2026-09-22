// ============================================================
// AI Question Generator — Deterministic Mock Provider
// Used for automated tests and offline environments. Zero network, zero billing.
// ============================================================

import type {
  GenerationInput,
  ProviderGenerationResult,
  QuestionGenerationProvider,
  RawGeneratedQuestion,
} from './types.ts';
import { PROMPT_VERSION, computeDifficultyDistribution } from './prompt.ts';

export type MockScenario =
  | 'valid'
  | 'malformed_json'
  | 'wrong_option_count'
  | 'invalid_correct_index'
  | 'duplicate_options'
  | 'fewer_questions'
  | 'too_many_questions'
  | 'provider_timeout'
  | 'rate_limit_429'
  | 'server_error_500'
  | 'policy_refusal'
  | 'arabic_content'
  | 'mixed_partial';

export class MockQuestionGenerationProvider implements QuestionGenerationProvider {
  name = 'mock-provider';
  model = 'mock-model-v1';
  public callCount: number = 0;
  private scenario: MockScenario = 'valid';
  private customQuestions?: RawGeneratedQuestion[];
  private customRawResponse?: string;

  constructor(scenario: MockScenario = 'valid') {
    this.scenario = scenario;
    this.callCount = 0;
  }

  setScenario(scenario: MockScenario) {
    this.scenario = scenario;
    this.customQuestions = undefined;
    this.customRawResponse = undefined;
  }

  resetCallCount() {
    this.callCount = 0;
  }

  setCustomQuestions(questions: RawGeneratedQuestion[]) {
    this.customQuestions = questions;
  }

  setCustomRawResponse(raw: string) {
    this.customRawResponse = raw;
  }

  async generateQuestions(input: GenerationInput): Promise<ProviderGenerationResult> {
    this.callCount++;
    const promptVersion = PROMPT_VERSION;

    // Handle failure scenarios
    if (this.scenario === 'provider_timeout') {
      return {
        success: false,
        provider: this.name,
        model: this.model,
        promptVersion,
        error: {
          code: 'TIMEOUT',
          message: 'Batas waktu koneksi ke provider AI terlampaui (timeout)',
          status: 408,
          isRetryable: true,
        },
      };
    }

    if (this.scenario === 'rate_limit_429') {
      return {
        success: false,
        provider: this.name,
        model: this.model,
        promptVersion,
        error: {
          code: 'RATE_LIMIT',
          message: 'Batas kuota panggilan AI terlampaui (429 Too Many Requests)',
          status: 429,
          isRetryable: true,
        },
      };
    }

    if (this.scenario === 'server_error_500') {
      return {
        success: false,
        provider: this.name,
        model: this.model,
        promptVersion,
        error: {
          code: 'PROVIDER_ERROR',
          message: 'Terjadi kesalahan pada server AI provider (500 Internal Server Error)',
          status: 500,
          isRetryable: true,
        },
      };
    }

    if (this.scenario === 'policy_refusal') {
      return {
        success: false,
        provider: this.name,
        model: this.model,
        promptVersion,
        error: {
          code: 'POLICY_REFUSAL',
          message: 'Permintaan ditolak oleh kebijakan keamanan konten provider AI (safety filter)',
          status: 400,
          isRetryable: false,
        },
      };
    }

    if (this.scenario === 'malformed_json') {
      return {
        success: true,
        rawResponse: '{"questions": [ { stem: "incomplete json...',
        provider: this.name,
        model: this.model,
        promptVersion,
      };
    }

    // Custom questions override
    if (this.customQuestions) {
      return {
        success: true,
        questions: this.customQuestions,
        rawResponse: JSON.stringify({ questions: this.customQuestions }),
        provider: this.name,
        model: this.model,
        promptVersion,
      };
    }

    // Custom raw response override
    if (this.customRawResponse) {
      return {
        success: true,
        rawResponse: this.customRawResponse,
        provider: this.name,
        model: this.model,
        promptVersion,
      };
    }

    const dist = computeDifficultyDistribution(input.questionCount, input.difficultyMode);
    const assignedDifficulties: Array<'easy' | 'balanced' | 'hard'> = [];
    for (let i = 0; i < dist.easy; i++) assignedDifficulties.push('easy');
    for (let i = 0; i < dist.balanced; i++) assignedDifficulties.push('balanced');
    for (let i = 0; i < dist.hard; i++) assignedDifficulties.push('hard');

    const isArabic =
      this.scenario === 'arabic_content' ||
      input.subject.toLowerCase().includes('arab') ||
      input.topic.toLowerCase().includes('arab');

    let count = input.questionCount;
    if (this.scenario === 'fewer_questions') {
      count = Math.max(1, input.questionCount - 2);
    } else if (this.scenario === 'too_many_questions') {
      count = input.questionCount + 3;
    }

    const questions: RawGeneratedQuestion[] = [];

    for (let i = 0; i < count; i++) {
      const qNum = i + 1;
      const diff = assignedDifficulties[i] || 'balanced';

      if (this.scenario === 'wrong_option_count') {
        // Only 2 options (violates min 3)
        questions.push({
          stem: `Pertanyaan #${qNum} tentang ${input.topic}?`,
          options: [
            { label: 'A', text: 'Opsi A' },
            { label: 'B', text: 'Opsi B' },
          ],
          correctIndex: 0,
          explanation: 'Penjelasan opsi',
          difficulty: diff,
        });
        continue;
      }

      if (this.scenario === 'invalid_correct_index') {
        // Points to index 99
        questions.push({
          stem: `Pertanyaan #${qNum} tentang ${input.topic}?`,
          options: [
            { label: 'A', text: 'Pilihan A' },
            { label: 'B', text: 'Pilihan B' },
            { label: 'C', text: 'Pilihan C' },
            { label: 'D', text: 'Pilihan D' },
          ],
          correctIndex: 99,
          explanation: 'Penjelasan opsi salah index',
          difficulty: diff,
        });
        continue;
      }

      if (this.scenario === 'duplicate_options') {
        // Duplicate options A and B
        questions.push({
          stem: `Pertanyaan #${qNum} tentang ${input.topic}?`,
          options: [
            { label: 'A', text: 'Pilihan Identik' },
            { label: 'B', text: 'Pilihan Identik' },
            { label: 'C', text: 'Pilihan C' },
            { label: 'D', text: 'Pilihan D' },
          ],
          correctIndex: 0,
          explanation: 'Penjelasan duplikat opsi',
          difficulty: diff,
        });
        continue;
      }

      if (this.scenario === 'mixed_partial' && i === count - 1) {
        // Last question is invalid
        questions.push({
          stem: '', // Empty stem
          options: [{ label: 'A', text: 'Opsi A' }],
          correctIndex: 0,
          difficulty: diff,
        });
        continue;
      }

      if (isArabic) {
        questions.push({
          stem: `مَا هُوَ الْمَعْنَى الصَّحِيحُ لِلْكَلِمَةِ فِي مَوْضُوعِ ${input.topic} (رقم ${qNum})؟`,
          options: [
            { label: 'A', text: 'الْإِجَابَةُ الْأُولَى الصَّحِيحَةُ' },
            { label: 'B', text: 'الْإِجَابَةُ الثَّانِيَةُ غَيْرُ الصَّحِيحَةِ' },
            { label: 'C', text: 'الْإِجَابَةُ الثَّالِثَةُ الْخَاطِئَةُ' },
            { label: 'D', text: 'الْإِجَابَةُ الرَّابِعَةُ' },
          ],
          correctIndex: 0,
          explanation: 'الْإِجَابَةُ (A) هِيَ الصَّحِيحَةُ دَائِمًا فِي هَذَا الِاخْتِبَارِ',
          difficulty: diff,
        });
      } else {
        const letters = ['A', 'B', 'C', 'D'];
        const correctIdx = i % 4;
        questions.push({
          stem: `Berdasarkan materi ${input.topic}, manakah pernyataan yang paling tepat mengenai aspek ke-${qNum}?`,
          options: letters.map((l, idx) => ({
            label: l,
            text:
              idx === correctIdx
                ? `Pernyataan yang benar secara konseptual untuk aspek #${qNum} pada materi ${input.topic}.`
                : `Pengecoh ${l} yang tampak meyakinkan namun tidak akurat untuk aspek #${qNum}.`,
          })),
          correctIndex: correctIdx,
          explanation: `Pilihan ${letters[correctIdx]} tepat karena memenuhi prinsip utama ${input.topic}.`,
          difficulty: diff,
        });
      }
    }

    return {
      success: true,
      questions,
      rawResponse: JSON.stringify({ questions }),
      provider: this.name,
      model: this.model,
      promptVersion,
    };
  }
}
