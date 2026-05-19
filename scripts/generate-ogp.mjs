/**
 * OGP画像生成（SVG → PNG via sharp）。
 * SHARED_CONFIG.md の方針に従い、全プロジェクト統一の sharp 方式。
 *
 * 使い方:
 *   npm run generate:ogp
 *
 * 出力: public/ogp.png (1200x630)
 */
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'public', 'ogp.png');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
  </defs>

  <!-- 背景 -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- 装飾: 上下のアクセントライン -->
  <rect x="0" y="0" width="1200" height="3" fill="#ff9b6b" opacity="0.7"/>
  <rect x="0" y="627" width="1200" height="3" fill="#6cb6ff" opacity="0.7"/>

  <!-- メインタイトル -->
  <text x="600" y="240" font-family="-apple-system, 'Segoe UI', sans-serif" font-size="84" font-weight="700" fill="#e6edf3" text-anchor="middle" letter-spacing="-1">
    AI Roundtable
  </text>

  <!-- サブタイトル -->
  <text x="600" y="305" font-family="-apple-system, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', sans-serif" font-size="32" fill="#8b949e" text-anchor="middle">
    AIたちが議論する円卓会議
  </text>

  <!-- 3キャラのバッジ -->
  <g transform="translate(450, 430)">
    <circle cx="0" cy="0" r="38" fill="#ff9b6b"/>
    <text x="0" y="14" font-size="40" font-weight="700" fill="#0d1117" text-anchor="middle" font-family="-apple-system, sans-serif">☀</text>
  </g>
  <g transform="translate(600, 430)">
    <circle cx="0" cy="0" r="38" fill="#6cb6ff"/>
    <text x="0" y="14" font-size="40" font-weight="700" fill="#0d1117" text-anchor="middle" font-family="-apple-system, sans-serif">?</text>
  </g>
  <g transform="translate(750, 430)">
    <circle cx="0" cy="0" r="38" fill="#94c585"/>
    <text x="0" y="14" font-size="40" font-weight="700" fill="#0d1117" text-anchor="middle" font-family="-apple-system, sans-serif">◎</text>
  </g>

  <!-- 接続線（議論を表現） -->
  <line x1="490" y1="430" x2="560" y2="430" stroke="#30363d" stroke-width="2" stroke-dasharray="4 4"/>
  <line x1="640" y1="430" x2="710" y2="430" stroke="#30363d" stroke-width="2" stroke-dasharray="4 4"/>

  <!-- URL -->
  <text x="600" y="555" font-family="ui-monospace, 'Cascadia Code', monospace" font-size="24" fill="#8b949e" text-anchor="middle" letter-spacing="1">
    roundtable.simtool.dev
  </text>
</svg>
`;

const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
await sharp(pngBuffer).toFile(OUTPUT_PATH);
console.log('OGP image generated:', OUTPUT_PATH);
