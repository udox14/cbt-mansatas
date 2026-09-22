// ============================================================
// AI Question Generator — Provider Factory
// ============================================================

import type { Env } from '../../types.ts';
import type { QuestionGenerationProvider } from './types.ts';
import { MockQuestionGenerationProvider } from './mock-provider.ts';
import { HttpQuestionGenerationProvider } from './http-provider.ts';

let customProviderOverride: QuestionGenerationProvider | null = null;

/**
 * Sets a custom provider override (used primarily by automated test suites).
 */
export function setCustomAiProvider(provider: QuestionGenerationProvider | null) {
  customProviderOverride = provider;
}

/**
 * Resolves the active AI provider based on environment bindings.
 * Defaults to MockQuestionGenerationProvider if no API key is configured,
 * ensuring test suites and offline setups run safely without external calls.
 */
export function getAiProvider(env: Env): QuestionGenerationProvider {
  if (customProviderOverride) {
    return customProviderOverride;
  }

  const providerName = (env.AI_PROVIDER || '').trim().toLowerCase();
  const apiKey = (env.AI_API_KEY || '').trim();

  // If mock explicitly requested or no API key is provided, return safe mock provider
  if (providerName === 'mock' || !apiKey) {
    return new MockQuestionGenerationProvider();
  }

  return new HttpQuestionGenerationProvider({
    providerName,
    apiKey,
    model: env.AI_MODEL,
    baseUrl: env.AI_BASE_URL,
  });
}
