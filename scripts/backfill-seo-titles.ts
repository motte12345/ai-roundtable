/**
 * 既存の seo_title が NULL の completed 議題に対し、Gemini で SEO タイトルを生成して UPDATE する。
 *
 * 使い方:
 *   npm run backfill:seo -- --local
 *   npm run backfill:seo -- --remote
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { generateSeoTitle } from '../workers/lib/seo-title.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const target = remote ? '--remote' : '--local';
const targetLabel = remote ? 'REMOTE' : 'LOCAL';

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set in .env');
  process.exit(1);
}

console.log(`\n=== Backfill SEO titles on ${targetLabel} D1 ===\n`);

interface Row {
  id: number;
  title: string;
}
const json = execSync(
  `npx wrangler d1 execute ai-roundtable ${target} --command "SELECT id, title FROM topics WHERE status='completed' AND seo_title IS NULL ORDER BY id" --json`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] },
);
const data = JSON.parse(json) as Array<{ results?: Row[] }>;
const rows = data[0]?.results ?? [];

console.log(`Found ${rows.length} completed topics without seo_title.\n`);
if (rows.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

const updates: string[] = [];
const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY };

for (const row of rows) {
  process.stdout.write(`  #${row.id} "${row.title}" → `);
  const seo = await generateSeoTitle(row.title, env);
  if (seo) {
    console.log(`"${seo}"`);
    const escaped = seo.replace(/'/g, "''");
    updates.push(`UPDATE topics SET seo_title='${escaped}' WHERE id=${row.id};`);
  } else {
    console.log('(failed)');
  }
  // Gemini レート制限対策で少し待つ
  await new Promise((r) => setTimeout(r, 800));
}

console.log(`\nGenerated: ${updates.length} / ${rows.length}\n`);

if (updates.length === 0) {
  console.log('No updates.');
  process.exit(0);
}

const dataDir = join(ROOT, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const sqlPath = join(dataDir, 'backfill-seo.sql');
writeFileSync(sqlPath, updates.join('\n') + '\n', 'utf-8');
console.log(`Wrote SQL: ${sqlPath}\n`);

console.log('Applying updates...\n');
execSync(`npx wrangler d1 execute ai-roundtable ${target} --file "${sqlPath}"`, { stdio: 'inherit' });
console.log('\n✓ Backfill complete.');
