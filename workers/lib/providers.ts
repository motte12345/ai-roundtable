/**
 * LLM プロバイダクライアント。
 * scripts と workers の両方から参照される（Workers ランタイム互換、fetch API のみ使用）。
 */
import type { Speaker } from './prompts.js';

export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface CompletionRequest {
  systemPrompt: string;
  history: Message[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResponse {
  text: string;
  provider: string;
  model: string;
}

export interface Provider {
  name: string;
  model: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public retryable: boolean = false,
  ) {
    super(`[${provider}] ${message}`);
  }
}

// =====================================================
// OpenAI 互換クライアント (Groq, Cerebras 等)
// =====================================================

interface OpenAIConfig {
  name: string;
  model: string;
  endpoint: string;
  apiKey: string;
}

function createOpenAICompatibleProvider(config: OpenAIConfig): Provider {
  return {
    name: config.name,
    model: config.model,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const messages = [
        { role: 'system', content: req.systemPrompt },
        ...req.history,
      ];

      const res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          max_tokens: req.maxTokens ?? 350,
          temperature: req.temperature ?? 0.85,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        throw new ProviderError(
          config.name,
          `HTTP ${res.status}: ${body.slice(0, 200)}`,
          res.status,
          retryable,
        );
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) {
        throw new ProviderError(config.name, 'Empty response', undefined, true);
      }

      return { text, provider: config.name, model: config.model };
    },
  };
}

// =====================================================
// Gemini クライアント (独自API)
// =====================================================

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function createGeminiProvider(model: string, apiKey: string): Provider {
  return {
    name: 'gemini',
    model,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const contents = req.history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const url = `${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: req.systemPrompt }] },
          contents,
          generationConfig: {
            maxOutputTokens: req.maxTokens ?? 400,
            temperature: req.temperature ?? 0.85,
            // Gemini 2.5/3.x は thinking がデフォルトONで maxOutputTokens を消費する。
            // 議論発言には不要なので 0 に固定（3.x でも受理されることを実 API で確認済み）
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        throw new ProviderError(
          'gemini',
          `HTTP ${res.status}: ${body.slice(0, 200)}`,
          res.status,
          retryable,
        );
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
      if (!text) {
        throw new ProviderError('gemini', 'Empty response', undefined, true);
      }

      return { text, provider: 'gemini', model };
    },
  };
}

// =====================================================
// プロバイダ割当
// =====================================================

export interface ProviderEnv {
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  MISTRAL_API_KEY?: string;
}

interface ProviderAssignment {
  primary: Provider;
  fallback: Provider;
}

// 2026-06-24: Gemini 3.x へ更新（Optimist/Host）。無料キーで実応答・thinkingBudget:0 受理・
// 出力品質/字数とも 2.5 と同等以上を実 API で確認済み。pinned版を使う（-latest は挙動が動くため）。
function geminiFlash(env: ProviderEnv): Provider {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  return createGeminiProvider('gemini-3.5-flash', env.GEMINI_API_KEY);
}

function geminiFlashLite(env: ProviderEnv): Provider {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  return createGeminiProvider('gemini-3.1-flash-lite', env.GEMINI_API_KEY);
}

function groqLlama70B(env: ProviderEnv): Provider {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  return createOpenAICompatibleProvider({
    name: 'groq',
    model: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: env.GROQ_API_KEY,
  });
}

/**
 * Groq Llama 4 Scout (17B active, 16-expert MoE)。
 * Llama 3.3 70B とは別の TPD バケットを持つので、70B の枯渇対策として併用する。
 * Maverick は 2026-05 時点で Groq 提供なし（/models で確認済）、Scout が利用可能な唯一の Llama 4 系。
 */
function groqLlama4Scout(env: ProviderEnv): Provider {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  return createOpenAICompatibleProvider({
    name: 'groq',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: env.GROQ_API_KEY,
  });
}

function groqLlama8B(env: ProviderEnv): Provider {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  return createOpenAICompatibleProvider({
    name: 'groq',
    model: 'llama-3.1-8b-instant',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: env.GROQ_API_KEY,
  });
}

function cerebrasGptOss(env: ProviderEnv): Provider {
  if (!env.CEREBRAS_API_KEY) throw new Error('CEREBRAS_API_KEY not set');
  return createOpenAICompatibleProvider({
    name: 'cerebras',
    model: 'gpt-oss-120b',
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    apiKey: env.CEREBRAS_API_KEY,
  });
}

export function getProviderAssignment(speaker: Speaker, env: ProviderEnv): ProviderAssignment {
  switch (speaker) {
    case 'optimist':
      return { primary: geminiFlash(env), fallback: groqLlama8B(env) };
    case 'skeptic':
      // Llama 4 Scout (別 TPD バケット) を primary に。fallback は実績のある 70B
      return { primary: groqLlama4Scout(env), fallback: groqLlama70B(env) };
    case 'zen':
      return { primary: groqLlama70B(env), fallback: cerebrasGptOss(env) };
    case 'host':
      return { primary: geminiFlashLite(env), fallback: groqLlama8B(env) };
  }
}

// =====================================================
// Fallback 付き実行
// =====================================================

export async function completeWithFallback(
  req: CompletionRequest,
  opts: { primary: Provider; fallback: Provider },
): Promise<CompletionResponse> {
  const order = [opts.primary, opts.fallback];
  const errors: string[] = [];

  for (const provider of order) {
    try {
      return await provider.complete(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      console.warn(`[fallback] ${provider.name}/${provider.model} failed: ${msg}`);
    }
  }

  throw new Error(`All providers failed: ${errors.join(' | ')}`);
}
