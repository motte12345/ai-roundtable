/**
 * wrangler dev は wrangler.toml の `[assets].directory` (= dist/) が存在しないと起動できない。
 * 開発時は vite dev (port 5173) でフロントを動かし、Worker は /api/* だけ提供するため、
 * dist/ にビルド済みアセットは不要。最低限 dist/index.html だけ存在させて wrangler dev を通す。
 *
 * 本番デプロイ前は npm run build で正規の dist/ が生成されるので上書きされる。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
if (!existsSync('dist/index.html')) {
  writeFileSync(
    'dist/index.html',
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI Roundtable (dev)</title></head><body><p>Run <code>npm run build</code> to generate the production frontend, or visit <a href="http://localhost:5173/">http://localhost:5173/</a> for the dev server.</p></body></html>',
    'utf-8',
  );
}
