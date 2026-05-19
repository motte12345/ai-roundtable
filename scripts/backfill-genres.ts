/**
 * 既存の `genre IS NULL` 議題に対し、タイトルからジャンルを推定して UPDATE する。
 *
 * 使い方:
 *   npm run backfill:genres -- --local           # ローカル、NULL のみ
 *   npm run backfill:genres -- --remote          # 本番、NULL のみ
 *   npm run backfill:genres -- --remote --force  # 本番、全議題を再分類（既存 genre 上書き）
 *
 * --force は genre-infer のロジック変更後に使う。Host が誤タグした分も上書きされる点に注意。
 *
 * 動作:
 *   1. wrangler d1 execute で対象議題を取得
 *   2. 各タイトルに inferGenre() を適用
 *   3. 推定できたものを UPDATE する SQL ファイルを `data/backfill-genres.sql` に書き出し
 *   4. wrangler d1 execute --file で適用
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferGenre } from '../workers/lib/genre-infer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const local = args.includes('--local') || !remote;
const force = args.includes('--force');

const target = remote ? '--remote' : '--local';
const targetLabel = remote ? 'REMOTE' : 'LOCAL';
const modeLabel = force ? 'ALL (force overwrite)' : 'NULL only';

console.log(`\n=== Backfill genres on ${targetLabel} D1 (${modeLabel}) ===\n`);

// 1. SELECT
// Node.js v24+ では execFileSync で .cmd 直接実行が禁止されたため、execSync (shell経由) で叩く
const whereClause = force ? '1=1' : 'genre IS NULL';
const selectCmd = `npx wrangler d1 execute ai-roundtable ${target} --command "SELECT id, title, genre FROM topics WHERE ${whereClause} ORDER BY id" --json`;
const json = execSync(selectCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });

interface Row {
  id: number;
  title: string;
  genre: string | null;
}
const data = JSON.parse(json) as Array<{ results?: Row[] }>;
const rows: Row[] = data[0]?.results ?? [];

console.log(`Found ${rows.length} topics to evaluate.\n`);

if (rows.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

// 2. 推定
const updates: string[] = [];
const skipped: Row[] = [];
let unchanged = 0;

for (const row of rows) {
  const inferred = inferGenre(row.title);
  if (!inferred) {
    skipped.push(row);
    continue;
  }
  if (force && inferred === row.genre) {
    unchanged++;
    continue;
  }
  // SQLインジェクション対策: id は数値、genre は固定文字列のみ
  updates.push(`UPDATE topics SET genre = '${inferred}' WHERE id = ${row.id};`);
  const before = row.genre ?? 'null';
  const arrow = before === inferred ? '' : ` (was ${before})`;
  console.log(`  #${row.id} [${inferred}]${arrow} ${row.title}`);
}

console.log(`\nUpdated: ${updates.length}, Unchanged: ${unchanged}, Skipped: ${skipped.length}\n`);

if (skipped.length > 0) {
  console.log('Could not infer (will remain as 未分類):');
  for (const s of skipped) console.log(`  #${s.id} ${s.title}`);
  console.log('');
}

if (updates.length === 0) {
  console.log('No updates to apply.');
  process.exit(0);
}

// 3. SQL ファイル書き出し
const dataDir = join(ROOT, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const sqlPath = join(dataDir, 'backfill-genres.sql');
writeFileSync(sqlPath, updates.join('\n') + '\n', 'utf-8');
console.log(`Wrote SQL: ${sqlPath}\n`);

// 4. 適用
console.log('Applying updates...\n');
const applyCmd = `npx wrangler d1 execute ai-roundtable ${target} --file "${sqlPath}"`;
execSync(applyCmd, { stdio: 'inherit' });

console.log('\n✓ Backfill complete.');
// loaded check: avoid unused variable warning
void local;
