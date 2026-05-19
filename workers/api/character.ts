/**
 * キャラプロフィール API。
 * GET /api/character/:speaker
 * - 統計（総発言数、担当議題数、平均文字数）
 * - 直近 N 件の発言（議題タイトル付き）
 * - 簡易頻出語（カタカナ語 / 漢字2文字以上の単語をカウント）
 */
import type { DB } from '../lib/db.js';

const VALID_SPEAKERS = ['host', 'optimist', 'skeptic', 'zen'] as const;
type Speaker = (typeof VALID_SPEAKERS)[number];

const STOP_WORDS = new Set([
  'こと', 'もの', 'ため', 'よう', 'これ', 'それ', 'あれ', 'ここ', 'そこ', 'あそこ',
  'する', 'いる', 'ある', 'なる', '思う', 'できる', '考える', '言う',
  'です', 'ます', 'なる', 'いう', 'なる',
  'について', 'においては', 'における', 'における',
]);

function extractFrequentWords(messages: Array<{ content: string }>, top = 10): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    // カタカナ単語（2文字以上）+ 漢字単語（2文字以上）+ 英単語（4文字以上）
    const words = m.content.match(/[ァ-ヶー]{2,}|[一-龯]{2,}|[A-Za-z]{4,}/g) ?? [];
    for (const w of words) {
      if (STOP_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

export async function handleCharacter(db: DB, speakerParam: string): Promise<Response> {
  if (!(VALID_SPEAKERS as readonly string[]).includes(speakerParam)) {
    return new Response(JSON.stringify({ error: 'Invalid speaker' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const speaker = speakerParam as Speaker;

  const [stats, recent] = await Promise.all([
    db.getCharacterStats(speaker),
    db.getCharacterMessages(speaker, 30),
  ]);

  const frequent_words = extractFrequentWords(recent, 12);

  return new Response(
    JSON.stringify({
      speaker,
      stats,
      recent_messages: recent,
      frequent_words,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    },
  );
}
