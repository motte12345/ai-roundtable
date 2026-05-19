/**
 * GET /api/relations
 * キャラ間の言及関係マトリクスを返す。
 *
 * レスポンス例:
 * {
 *   speakers: ["host", "optimist", "skeptic", "zen"],
 *   matrix: {
 *     optimist: { total: 30, mentions: { host: 2, skeptic: 8, zen: 6 } },
 *     ...
 *   }
 * }
 */
import type { DB } from '../lib/db.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300', // 5分キャッシュ（更新頻度低い）
};

type Speaker = 'host' | 'optimist' | 'skeptic' | 'zen';
const SPEAKERS: Speaker[] = ['host', 'optimist', 'skeptic', 'zen'];

interface SpeakerRow {
  total: number;
  mentions: Record<Speaker, number>;
}

export async function handleRelations(db: DB): Promise<Response> {
  const rows = await db.getRelationMatrix();

  const matrix: Record<Speaker, SpeakerRow> = {
    host: { total: 0, mentions: { host: 0, optimist: 0, skeptic: 0, zen: 0 } },
    optimist: { total: 0, mentions: { host: 0, optimist: 0, skeptic: 0, zen: 0 } },
    skeptic: { total: 0, mentions: { host: 0, optimist: 0, skeptic: 0, zen: 0 } },
    zen: { total: 0, mentions: { host: 0, optimist: 0, skeptic: 0, zen: 0 } },
  };

  for (const r of rows) {
    if (!SPEAKERS.includes(r.from_speaker as Speaker)) continue;
    const speaker = r.from_speaker as Speaker;
    matrix[speaker] = {
      total: r.total_messages,
      mentions: {
        host: r.mentions_host,
        optimist: r.mentions_optimist,
        skeptic: r.mentions_skeptic,
        zen: r.mentions_zen,
      },
    };
  }

  return new Response(
    JSON.stringify({ speakers: SPEAKERS, matrix }),
    { status: 200, headers: JSON_HEADERS },
  );
}
