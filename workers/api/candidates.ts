/**
 * 議題候補一覧 + 投票 API。
 * - GET /api/candidates: pending host_proposed 議題を票数降順で返す
 * - POST /api/vote: Turnstile 認証付きで1議題1票を記録
 */
import type { DB } from '../lib/db.js';
import { hashVoter, verifyTurnstile } from '../lib/turnstile.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  // 投票結果を即時反映したいので短めキャッシュ
  'Cache-Control': 'public, max-age=15',
};

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

function jsonResponse(data: unknown, status = 200, headers = JSON_HEADERS): Response {
  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * GET /api/candidates?genre=...&limit=30
 */
export async function handleCandidates(db: DB, url: URL): Promise<Response> {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '30'), 100);
  const genre = url.searchParams.get('genre');
  const candidates = await db.getCandidates(limit, genre);
  const counts = await db.getCandidateGenreCounts();
  return jsonResponse({ candidates, genre_counts: counts });
}

interface VotePayload {
  topic_id?: unknown;
  turnstile_token?: unknown;
}

/**
 * POST /api/vote
 * Body: { topic_id: number, turnstile_token: string }
 */
export async function handleVote(
  db: DB,
  request: Request,
  env: { TURNSTILE_SECRET_KEY?: string },
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, NO_CACHE_HEADERS);
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    return jsonResponse({ error: 'turnstile_not_configured' }, 503, NO_CACHE_HEADERS);
  }

  let payload: VotePayload;
  try {
    payload = (await request.json()) as VotePayload;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, NO_CACHE_HEADERS);
  }

  const topicId = Number(payload.topic_id);
  const token = typeof payload.turnstile_token === 'string' ? payload.turnstile_token : '';
  if (!Number.isInteger(topicId) || topicId <= 0) {
    return jsonResponse({ error: 'invalid_topic_id' }, 400, NO_CACHE_HEADERS);
  }
  if (token.length === 0) {
    return jsonResponse({ error: 'missing_turnstile_token' }, 400, NO_CACHE_HEADERS);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const verify = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip);
  if (!verify.ok) {
    return jsonResponse(
      { error: 'turnstile_verify_failed', detail: verify.errors },
      403,
      NO_CACHE_HEADERS,
    );
  }

  // 候補議題かどうか確認
  const topic = await db.getTopicById(topicId);
  if (!topic || topic.status !== 'pending' || topic.source !== 'host_proposed') {
    return jsonResponse({ error: 'topic_not_open_for_voting' }, 409, NO_CACHE_HEADERS);
  }

  // IP ハッシュで重複防止
  const voterHash = await hashVoter(ip || 'unknown');
  const now = Math.floor(Date.now() / 1000);
  const accepted = await db.recordVote(topicId, voterHash, now);

  if (!accepted) {
    return jsonResponse(
      { ok: false, reason: 'already_voted', topic_id: topicId, votes: topic.votes },
      200,
      NO_CACHE_HEADERS,
    );
  }

  // 最新の票数を返す（クライアントの表示同期用）
  const updated = await db.getTopicById(topicId);
  return jsonResponse(
    { ok: true, topic_id: topicId, votes: updated?.votes ?? topic.votes + 1 },
    200,
    NO_CACHE_HEADERS,
  );
}
