/**
 * 議論完了時に「議論のハイライト」3種を選定する。
 * Mistral Experiment tier (mistral-small-latest) を優先、失敗時 Groq Llama 3.1 8B Instant に fallback。
 *
 * 注意: 発言は実測 ~500字 × 11 あり全文だと Groq 8B の TPM 6000 を超えて 413 になるため、
 * 各ターンを HIGHLIGHT_EXCERPT_LEN 文字に切り詰めて渡す（選定には冒頭抜粋で十分）。
 * 出力は JSON: { sharpest, constructive, illuminating }（各 turn_no/reason、キー名厳守）。
 */
import type { ProviderEnv } from './providers.js';

const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** ハイライト選定に渡す1ターンあたりの抜粋長（TPM 超過対策） */
const HIGHLIGHT_EXCERPT_LEN = 200;

export interface HighlightItem {
  turn_no: number;
  reason: string;
}

export interface Highlights {
  sharpest: HighlightItem;
  constructive: HighlightItem;
  illuminating: HighlightItem;
}

export interface HighlightInput {
  turn_no: number;
  speaker: string;
  content: string;
}

const SYSTEM_PROMPT = `あなたは AI 議論サイトの編集者です。
入力された議論全体を読み、3種類のハイライトを選定してください。

- "sharpest": **最も鋭い反論**・前提を疑った発言（多くの場合 Skeptic だが、別キャラでも可）
- "constructive": **最も建設的**・新しい視点を開いた発言（多くの場合 Optimist だが、別キャラでも可）
- "illuminating": **最も議論を整理し読者に気づきを与えた発言**（多くの場合 Zen だが、別キャラでも可）

## ルール
- Host (turn 1, 11) は対象外。turn 2〜10 から選ぶ
- 各カテゴリは別々のターンを選ぶ（同じターンを2つ以上に使わない）
- 各 \`reason\` は 30〜50字で「なぜその発言が際立つか」を1文で

## 出力形式
**キー名を厳守**し、次の JSON のみを返す（マークダウンで囲まない）。
\`turn_no\` は 2〜10 の整数、\`reason\` は文字列:
{"sharpest":{"turn_no":3,"reason":"..."},"constructive":{"turn_no":5,"reason":"..."},"illuminating":{"turn_no":7,"reason":"..."}}`;

interface ResponseShape {
  sharpest?: HighlightItem;
  constructive?: HighlightItem;
  illuminating?: HighlightItem;
}

function validateHighlight(h: unknown, turnRange: Set<number>): HighlightItem | null {
  if (!h || typeof h !== 'object') return null;
  const rec = h as Record<string, unknown>;
  // モデルが turn_no でなく turn を返すことがあるので両方受ける（防御的）
  const turn = Number(rec.turn_no ?? rec.turn);
  const reason = typeof rec.reason === 'string' ? rec.reason.trim() : '';
  if (!turnRange.has(turn) || reason.length === 0 || reason.length > 80) return null;
  return { turn_no: turn, reason };
}

interface JsonModeCallOpts {
  endpoint: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  label: string;
}

async function callOpenAIJsonMode(opts: JsonModeCallOpts): Promise<string | null> {
  const res = await fetch(opts.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userPrompt },
      ],
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.warn(`[highlights/${opts.label}] HTTP ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  return text || null;
}

function parseAndValidate(text: string, turnRange: Set<number>): Highlights | null {
  let parsed: ResponseShape;
  try {
    parsed = JSON.parse(text) as ResponseShape;
  } catch {
    return null;
  }
  const sharpest = validateHighlight(parsed.sharpest, turnRange);
  const constructive = validateHighlight(parsed.constructive, turnRange);
  const illuminating = validateHighlight(parsed.illuminating, turnRange);
  if (!sharpest || !constructive || !illuminating) return null;
  const turns = new Set([sharpest.turn_no, constructive.turn_no, illuminating.turn_no]);
  if (turns.size !== 3) return null;
  return { sharpest, constructive, illuminating };
}

export async function generateHighlights(
  topicTitle: string,
  messages: HighlightInput[],
  env: ProviderEnv,
): Promise<Highlights | null> {
  // turn 2〜10 が対象
  const eligible = messages.filter((m) => m.turn_no >= 2 && m.turn_no <= 10);
  if (eligible.length < 3) return null;
  const turnRange = new Set(eligible.map((m) => m.turn_no));

  // 各ターンを抜粋に切り詰める。発言は実測 ~500字あり、全文 × 11 だと小型モデルの
  // TPM 上限（Groq llama-3.1-8b-instant は 6000 TPM）を超えて 413 になる。
  // ハイライト選定にはどのターンが際立つか判別できれば十分なので冒頭抜粋で足りる。
  const transcript = messages
    .map(
      (m) =>
        `[turn ${m.turn_no}][${m.speaker}] ${Array.from(m.content).slice(0, HIGHLIGHT_EXCERPT_LEN).join('')}`,
    )
    .join('\n\n');

  const userText = `議題: 「${topicTitle}」\n\n## 議論全文\n${transcript}\n\n## タスク\n上記の議論から sharpest / constructive / illuminating をそれぞれ別々のターンから選び、JSON で返してください。`;

  // Mistral 優先 → Groq fallback
  const attempts: JsonModeCallOpts[] = [];
  if (env.MISTRAL_API_KEY) {
    attempts.push({
      endpoint: MISTRAL_ENDPOINT,
      model: 'mistral-small-latest',
      apiKey: env.MISTRAL_API_KEY,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: userText,
      maxTokens: 500,
      temperature: 0.3,
      label: 'mistral',
    });
  }
  if (env.GROQ_API_KEY) {
    attempts.push({
      endpoint: GROQ_ENDPOINT,
      model: 'llama-3.1-8b-instant',
      apiKey: env.GROQ_API_KEY,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: userText,
      maxTokens: 500,
      temperature: 0.3,
      label: 'groq',
    });
  }

  if (attempts.length === 0) return null;

  for (const opts of attempts) {
    try {
      const text = await callOpenAIJsonMode(opts);
      if (!text) continue;
      const result = parseAndValidate(text, turnRange);
      if (result) return result;
      console.warn(`[highlights/${opts.label}] response failed validation`);
    } catch (e) {
      console.warn(`[highlights/${opts.label}] generation failed:`, e);
    }
  }
  return null;
}
