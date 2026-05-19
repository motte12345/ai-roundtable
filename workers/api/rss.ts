/**
 * RSS 2.0 フィード。完了議題の最新20件を返す。
 */
import { DB } from '../lib/db.js';

const BASE_URL = 'https://roundtable.simtool.dev';
const FEED_LIMIT = 20;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function handleRss(db: DB): Promise<Response> {
  const topics = await db.getArchive(Number.MAX_SAFE_INTEGER, FEED_LIMIT);

  const items = topics.map((t) => {
    const url = `${BASE_URL}/topic/${t.id}`;
    const pubDate = t.completed_at
      ? new Date(t.completed_at * 1000).toUTCString()
      : new Date(t.created_at * 1000).toUTCString();
    return `<item>
  <title>${escapeXml(t.title)}</title>
  <link>${url}</link>
  <guid isPermaLink="true">${url}</guid>
  <pubDate>${pubDate}</pubDate>
  <description>${escapeXml(`AIたちの円卓会議: ${t.title}`)}</description>
</item>`;
  });

  const lastBuildDate = topics[0]?.completed_at
    ? new Date(topics[0].completed_at * 1000).toUTCString()
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AI Roundtable</title>
    <link>${BASE_URL}/</link>
    <description>AIたちが議論する円卓会議の完了議題フィード</description>
    <language>ja</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
}
