/**
 * Cloudflare Worker エントリポイント。
 * - fetch: API エンドポイント + 静的アセット配信
 * - scheduled: 15分おきに議論ターン進行
 */
import { handleAudio } from './api/audio.js';
import { handleCandidates, handleVote } from './api/candidates.js';
import { handleCharacter } from './api/character.js';
import { handleArchive, handleCurrent, handleGenres, handleRecent, handleTopic } from './api/handlers.js';
import { handleTopicOgHtml } from './api/og-html.js';
import { handleRelations } from './api/relations.js';
import { handleRss } from './api/rss.js';
import { handleSitemap } from './api/sitemap.js';
import { isBot } from './lib/bot-ua.js';
import { DB } from './lib/db.js';
import { notifyOnce } from './lib/line-notify.js';
import { getBudgetSnapshot } from './lib/tts-budget.js';
import { advanceOneTurn } from './lib/turn-runner.js';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI: Ai;
  AUDIO: R2Bucket;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  LINE_CHANNEL_TOKEN?: string;
  LINE_USER_ID?: string;
  ENVIRONMENT?: string;
}

export default {
  /**
   * HTTP リクエスト処理。
   * /api/* は内部処理、それ以外は静的アセット（フロント SPA）に委譲。
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const db = new DB(env.DB);

    if (path === '/sitemap.xml') {
      return handleSitemap(db);
    }
    if (path === '/rss.xml' || path === '/feed.xml') {
      return handleRss(db);
    }
    if (path.startsWith('/audio/')) {
      return handleAudio(env.AUDIO, path);
    }
    if (path === '/api/current') {
      return handleCurrent(db);
    }
    if (path === '/api/recent') {
      return handleRecent(db, url);
    }
    if (path === '/api/archive') {
      return handleArchive(db, url);
    }
    if (path === '/api/genres') {
      return handleGenres(db);
    }
    if (path === '/api/relations') {
      return handleRelations(db);
    }
    if (path === '/api/tts-status') {
      const snap = await getBudgetSnapshot(db);
      return new Response(JSON.stringify(snap), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    if (path === '/api/candidates') {
      return handleCandidates(db, url);
    }
    if (path === '/api/vote') {
      return handleVote(db, request, env);
    }
    const topicMatch = path.match(/^\/api\/topic\/(\d+)$/);
    if (topicMatch) {
      return handleTopic(db, Number(topicMatch[1]));
    }
    const characterMatch = path.match(/^\/api\/character\/([a-z]+)$/);
    if (characterMatch) {
      return handleCharacter(db, characterMatch[1]);
    }
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // SNS/検索エンジン bot で /topic/:id にアクセスがあった場合、
    // 議題情報を埋め込んだ OGP メタタグ入り HTML を返す（シェア時に議題タイトルが表示される）
    const topicPagematch = path.match(/^\/topic\/(\d+)\/?$/);
    if (topicPagematch && isBot(request.headers.get('user-agent'))) {
      return handleTopicOgHtml(db, Number(topicPagematch[1]));
    }

    // 静的アセット（SPA fallback は wrangler.toml 側で設定済み）
    return env.ASSETS.fetch(request);
  },

  /**
   * Cron 発火: 15分おきに1ターン進める。
   */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = new DB(env.DB);
    const now = Math.floor(Date.now() / 1000);

    // ctx.waitUntil で長時間処理を継続（CPU 制限とは別の I/O 待機時間枠）
    ctx.waitUntil(
      advanceOneTurn({ db, env, now })
        .then((result) => {
          console.log('[cron]', JSON.stringify(result));
        })
        .catch(async (err) => {
          console.error('[cron] error:', err);
          // ターンレベルの通知 (3回連続失敗) は turn-runner 側で処理する
          // ここではより上位の致命的エラー（DB接続不能等）を通知
          const msg = err instanceof Error ? err.message : String(err);
          await notifyOnce(
            db,
            'cron_fatal',
            `[ai-roundtable] Cron 致命的エラー\n${msg.slice(0, 500)}`,
            env,
            now,
          );
        }),
    );
  },
};
