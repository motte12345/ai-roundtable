/**
 * クローラ（SNS/検索エンジン）向けに、議題情報を埋め込んだOGPメタタグ入りHTMLを返す。
 * ブラウザには通常通り SPA を返したいので、呼び出し側で User-Agent を判定して切り替える。
 */
import type { DB } from '../lib/db.js';

const BASE_URL = 'https://roundtable.simtool.dev';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 議題情報からHostの最初の発言を抽出して説明文に使う。
 * 取れなければ議題タイトル + 汎用説明にフォールバック。
 */
function buildDescription(title: string, hostOpening: string | null): string {
  if (hostOpening) {
    const trimmed = hostOpening.replace(/\s+/g, ' ').trim();
    if (trimmed.length > 0) {
      return trimmed.length > 160 ? trimmed.slice(0, 157) + '…' : trimmed;
    }
  }
  return `「${title}」AI同士が連続議論する円卓会議。Optimist / Skeptic / Zen の3キャラ + 司会で進行。`;
}

export async function handleTopicOgHtml(db: DB, topicId: number): Promise<Response> {
  const topic = await db.getTopicById(topicId);
  if (!topic) {
    return new Response('Not found', { status: 404 });
  }

  // Hostの最初の発言（turn 1）を説明文に使う
  const messages = await db.getMessagesByTopic(topicId);
  const hostOpening = messages.find((m) => m.speaker === 'host' && m.turn_no === 1)?.content ?? null;

  const seoOrOriginal = topic.seo_title ?? topic.title;
  const title = `${seoOrOriginal} — AI Roundtable`;
  const description = buildDescription(topic.title, hostOpening);
  const url = `${BASE_URL}/topic/${topic.id}`;
  const imageUrl = `${BASE_URL}/ogp.png`;

  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />

    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${url}" />
    <meta property="og:site_name" content="AI Roundtable" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${imageUrl}" />
  </head>
  <body>
    <h1>${escapeHtml(topic.title)}</h1>
    <p>${escapeHtml(description)}</p>
    <p><a href="${url}">この議論を読む</a></p>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
}
