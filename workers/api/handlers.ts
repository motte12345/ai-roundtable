/**
 * REST API ハンドラ。
 */
import { DB } from '../lib/db.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // フロントは同一オリジンだが、デバッグ用に CORS 許可（本番では絞ってもOK）
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=30',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function notFound(): Response {
  return jsonResponse({ error: 'Not found' }, 404);
}

/**
 * GET /api/current
 * 現在進行中の議題 + 全発言
 */
export async function handleCurrent(db: DB): Promise<Response> {
  const topic = await db.getActiveTopic();
  if (!topic) {
    // active がなければ直近 completed を返す
    const recent = await db.getRecentCompletedTopics(1);
    if (recent.length === 0) return jsonResponse({ topic: null, messages: [] });
    const messages = await db.getMessagesByTopic(recent[0].id);
    return jsonResponse({ topic: recent[0], messages });
  }
  const messages = await db.getMessagesByTopic(topic.id);
  return jsonResponse({ topic, messages });
}

/**
 * GET /api/recent?limit=10
 * 直近の議題メタ情報（サイドバー用、軽量）
 */
export async function handleRecent(db: DB, url: URL): Promise<Response> {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '10'), 50);
  const topics = await db.getRecentCompletedTopics(limit);
  return jsonResponse({ topics });
}

/**
 * GET /api/archive?cursor=N&limit=20&genre=philosophy
 * 完了議題のページネーション（ジャンル絞込み可）
 */
export async function handleArchive(db: DB, url: URL): Promise<Response> {
  const cursor = Number(url.searchParams.get('cursor') ?? '999999999');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const genre = url.searchParams.get('genre');
  const topics = await db.getArchive(cursor, limit, genre);
  const nextCursor = topics.length === limit ? topics[topics.length - 1].id : null;
  return jsonResponse({ topics, next_cursor: nextCursor });
}

/**
 * GET /api/genres
 * 完了議題のジャンル別件数
 */
export async function handleGenres(db: DB): Promise<Response> {
  const counts = await db.getGenreCounts();
  return jsonResponse({ counts });
}

/**
 * GET /api/topic/:id
 * 特定議題の全発言
 */
export async function handleTopic(db: DB, id: number): Promise<Response> {
  const topic = await db.getTopicById(id);
  if (!topic) return notFound();
  const messages = await db.getMessagesByTopic(topic.id);
  return jsonResponse({ topic, messages });
}
