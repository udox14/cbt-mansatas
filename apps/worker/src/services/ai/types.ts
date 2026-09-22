// ============================================================
// AI Question Generator — Types & Contracts
// ============================================================

import type { AiDifficultyMode, AiVariationLevel } from '../../types.ts';

export interface GenerationInput {
  subject: string;
  targetGrade?: string | null;
  examTitle: string;
  domainContext: string;
  topic: string;
  additionalInstruction?: string;
  referenceText?: string;
  questionCount: number;
  difficultyMode: AiDifficultyMode;
  variationLevel: AiVariationLevel;
}

export interface RawGeneratedOption {
  label: string;
  text: string;
}

export interface RawGeneratedQuestion {
  stem: string;
  options: RawGeneratedOption[];
  correctIndex: number;
  explanation?: string;
  difficulty?: AiDifficultyMode;
}

export interface ProviderGenerationResult {
  success: boolean;
  questions?: RawGeneratedQuestion[];
  rawResponse?: string;
  error?: {
    code: string;
    message: string;
    status?: number;
    isRetryable?: boolean;
  };
  provider: string;
  model: string;
  promptVersion: string;
}

export interface QuestionGenerationProvider {
  name: string;
  model: string;
  generateQuestions(input: GenerationInput): Promise<ProviderGenerationResult>;
}

export interface DifficultyDistribution {
  easy: number;
  balanced: number;
  hard: number;
}
