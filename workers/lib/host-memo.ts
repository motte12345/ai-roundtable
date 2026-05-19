/**
 * 議論完了時に「司会のひとこと」(舞台裏メタコメント)を生成する。
 * Gemini 2.5 Flash-Lite（Host と同じ無料枠、既存実績あり）を使用。
 *
 * 議論本編とは別の小さな観察コメントで、観客体験を温かくするための演出。
 */
import type { ProviderEnv } from './providers.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `あなたは AI 議論サイトの司会 (Host) です。
完了した議論を読み返し、観客に向けた**司会のひとこと**を書いてください。
これは議論本編とは別の、舞台裏的なメタコメントです。

## ルール
- 50〜80字、1〜2文
- 議論の盛り上がり、意外な角度、印象的な一刺し、白熱したポイントなどに触れる
- 議論本編では言えなかった本音や客観的な観察を、自然な独り言の口調で
- 「Skeptic の〜という指摘が予想外でした」「Optimist と Zen の角度の違いが鮮明でしたね」のような具体性が欲しい
- 「素晴らしい議論でした」「みんな個性的でした」のような社交辞令や抽象は禁止
- 自分（Host）を主語にしてよい

## 出力
本文のみ1行。マークダウン記号・カッコ・引用符・「メモ:」のようなラベルは付けない。`;

export interface HostMemoInput {
  turn_no: number;
  speaker: string;
  content: string;
}

export async function generateHostMemo(
  topicTitle: string,
  messages: HostMemoInput[],
  env: ProviderEnv,
): Promise<string | null> {
  if (!env.GEMINI_API_KEY) return null;

  // 全11発言が揃っていることを期待するが、欠けても処理は続行
  if (messages.length < 5) return null;

  const transcript = messages
    .map((m) => `[turn ${m.turn_no}][${m.speaker}] ${m.content}`)
    .join('\n\n');

  const userText = `議題: 「${topicTitle}」\n\n## 議論全文\n${transcript}\n\n## タスク\n司会のひとことを書いてください。`;

  try {
    const url = `${GEMINI_ENDPOINT}/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.85,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      console.warn(`[host-memo] HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    let text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';

    // 余計な記号を除去
    text = text
      .replace(/^[「『"'`]+|[」』"'`]+$/g, '')
      .replace(/^(メモ|ひとこと|司会のひとこと|note)[:：]\s*/i, '')
      .trim();

    if (text.length === 0 || text.length > 150) return null;
    return text;
  } catch (e) {
    console.warn('[host-memo] generation failed:', e);
    return null;
  }
}
