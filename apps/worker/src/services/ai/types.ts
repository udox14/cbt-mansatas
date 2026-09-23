// ============================================================
// AI Question Generator — Types & Contracts
// Interaction Pattern: Proven MANSATAS RPPM Generator
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

export interface DifficultyDistribution {
  easy: number;
  balanced: number;
  hard: number;
}
