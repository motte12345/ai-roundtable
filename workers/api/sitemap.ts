/**
 * 動的 sitemap.xml 生成。
 * トップ・固定ページ + 完了議題（最大1000件）を返す。
 */
import { DB } from '../lib/db.js';

const BASE_URL = 'https://roundtable.simtool.dev';
const MAX_ARCHIVE_TOPICS = 1000;

export async function handleSitemap(db: DB): Promise<Response> {
  // 完了議題を最新順で取得（ID降順）
  const topics = await db.getArchive(Number.MAX_SAFE_INTEGER, MAX_ARCHIVE_TOPICS);

  const urls: string[] = [
    `<url><loc>${BASE_URL}/</loc><changefreq>always</changefreq><priority>1.0</priority></url>`,
  ];

  for (const t of topics) {
    const lastmod = t.completed_at
      ? new Date(t.completed_at * 1000).toISOString().split('T')[0]
      : undefined;
    const lastmodTag = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
    urls.push(
      `<url><loc>${BASE_URL}/topic/${t.id}</loc>${lastmodTag}<changefreq>never</changefreq><priority>0.7</priority></url>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900', // 15分キャッシュ（cron間隔と一致）
    },
  });
}
