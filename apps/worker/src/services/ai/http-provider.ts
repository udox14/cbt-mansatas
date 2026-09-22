// ============================================================
// AI Question Generator — HTTP Provider Adapter
// Standard fetch-based adapter for OpenAI, Gemini, and compatible endpoints.
// Zero external npm dependencies.
// ============================================================

import type {
  GenerationInput,
  ProviderGenerationResult,
  QuestionGenerationProvider,
} from './types.ts';
import { PROMPT_VERSION, buildSystemPrompt, buildUserPrompt } from './prompt.ts';
import { parseProviderJsonResponse } from './validator.ts';

export interface HttpProviderOptions {
  providerName?: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class HttpQuestionGenerationProvider implements QuestionGenerationProvider {
  name: string;
  model: string;
  private apiKey: string;
  private endpoint: string;
  private timeoutMs: number;

  constructor(options: HttpProviderOptions) {
    this.name = options.providerName || 'openai';
    this.model = options.model || (this.name === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs || 35000;

    if (options.baseUrl) {
      this.endpoint = options.baseUrl.endsWith('/chat/completions')
        ? options.baseUrl
        : `${options.baseUrl.replace(/\/$/, '')}/chat/completions`;
    } else if (this.name === 'gemini') {
      this.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    } else {
      this.endpoint = 'https://api.openai.com/v1/chat/completions';
    }
  }

  async generateQuestions(input: GenerationInput): Promise<ProviderGenerationResult> {
    const promptVersion = PROMPT_VERSION;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(input);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: input.variationLevel === 'high_variation' ? 0.8 : input.variationLevel === 'varied' ? 0.6 : 0.4,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) {
          return {
            success: false,
            provider: this.name,
            model: this.model,
            promptVersion,
            error: {
              code: 'AUTH_ERROR',
              message: 'Autentikasi ke provider AI gagal. Periksa konfigurasi API key.',
              status,
              isRetryable: false,
            },
          };
        }
        if (status === 429) {
          return {
            success: false,
            provider: this.name,
            model: this.model,
            promptVersion,
            error: {
              code: 'RATE_LIMIT',
              message: 'Batas kuota panggilan AI terlampaui (429 Too Many Requests).',
              status,
              isRetryable: true,
            },
          };
        }
        if (status >= 500) {
          return {
            success: false,
            provider: this.name,
            model: this.model,
            promptVersion,
            error: {
              code: 'PROVIDER_SERVER_ERROR',
              message: `Server AI mengalami gangguan internal (HTTP ${status}).`,
              status,
              isRetryable: true,
            },
          };
        }

        let errSnippet = '';
        try {
          const errBody = await response.json<any>();
          errSnippet = errBody?.error?.message || '';
        } catch {
          // Ignore JSON parse error on error response
        }

        return {
          success: false,
          provider: this.name,
          model: this.model,
          promptVersion,
          error: {
            code: 'HTTP_ERROR',
            message: `Panggilan ke provider AI gagal (HTTP ${status})${errSnippet ? `: ${errSnippet}` : ''}`,
            status,
            isRetryable: status >= 500,
          },
        };
      }

      const json = await response.json<any>();
      const choice = json?.choices?.[0];

      if (choice?.finish_reason === 'content_filter') {
        return {
          success: false,
          provider: this.name,
          model: this.model,
          promptVersion,
          error: {
            code: 'CONTENT_FILTER',
            message: 'Respons diblokir oleh filter keamanan konten provider AI.',
            status: 400,
            isRetryable: false,
          },
        };
      }

      const rawContent = choice?.message?.content;
      if (!rawContent) {
        return {
          success: false,
          provider: this.name,
          model: this.model,
          promptVersion,
          error: {
            code: 'EMPTY_RESPONSE',
            message: 'Provider AI mengembalikan respons kosong.',
            isRetryable: true,
          },
        };
      }

      const parsed = parseProviderJsonResponse(rawContent);
      if (!parsed.success || !parsed.questions) {
        return {
          success: false,
          provider: this.name,
          model: this.model,
          promptVersion,
          rawResponse: rawContent,
          error: {
            code: 'MALFORMED_OUTPUT',
            message: parsed.error || 'Format JSON dari AI tidak sesuai skema',
            isRetryable: true,
          },
        };
      }

      return {
        success: true,
        questions: parsed.questions,
        rawResponse: rawContent,
        provider: this.name,
        model: this.model,
        promptVersion,
      };
    } catch (e: any) {
      clearTimeout(timeoutId);

      if (e.name === 'AbortError') {
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

      return {
        success: false,
        provider: this.name,
        model: this.model,
        promptVersion,
        error: {
          code: 'NETWORK_ERROR',
          message: `Koneksi jaringan ke provider AI gagal: ${e.message || String(e)}`,
          isRetryable: true,
        },
      };
    }
  }
}
