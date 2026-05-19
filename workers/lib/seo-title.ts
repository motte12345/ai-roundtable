/**
 * 議題タイトルから SEO 向け別タイトルを生成する。
 * Gemini Flash を使う（軽量・無料枠）。
 */
import type { ProviderEnv } from './providers.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `あなたはSEOコピーライターです。
与えられたAI議論サイトの議題タイトルから、検索ユーザーがクリックしたくなる **SEO最適化タイトル** を1つだけ生成してください。

## 要件
- 25〜45文字（日本語）
- 元タイトルの本質を変えない
- 「AIが議論」「AIたちが本音で」「徹底検証」「○○派 vs ○○派」のような魅力的な語句を含める（ただし誇大表現は避ける）
- クエスチョン形式や対比表現を活用してよい

## 厳守事項
- 出力は **タイトル本文のみ1行**。説明・前置き・引用符・カギ括弧（「」）・コードブロック等は付けない
- 議題本来のジャンル外（例: 投資・医療・選挙・特定個人）に話を膨らませない`;

export async function generateSeoTitle(
  originalTitle: string,
  env: ProviderEnv,
): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;

  try {
    const url = `${GEMINI_ENDPOINT}/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          { role: 'user', parts: [{ text: `議題: ${originalTitle}` }] },
        ],
        generationConfig: {
          maxOutputTokens: 80,
          temperature: 0.7,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      console.warn(`[seo-title] HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    let text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';

    // 余計な記号を除去
    text = text
      .replace(/^[「『"'`]+|[」』"'`]+$/g, '')
      .replace(/^タイトル[:：]\s*/, '')
      .trim();

    if (text.length === 0 || text.length > 60) return null;
    return text;
  } catch (e) {
    console.warn('[seo-title] generation failed:', e);
    return null;
  }
}
