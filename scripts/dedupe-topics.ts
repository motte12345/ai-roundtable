/**
 * pending 状態の議題のうち、他の議題と重複しているものを 'rejected' に変更する。
 * 完了済み議題（active / completed）は変更しない（既に発言があるため）。
 *
 * 使い方:
 *   npm run dedupe:topics -- --local       # ローカル
 *   npm run dedupe:topics -- --remote      # 本番
 *   npm run dedupe:topics -- --remote --dry # ドライラン（変更なし、判定だけ表示）
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDuplicateTitle } from '../workers/lib/topic-similarity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const dryRun = args.includes('--dry');
const target = remote ? '--remote' : '--local';
const targetLabel = remote ? 'REMOTE' : 'LOCAL';

console.log(`\n=== Dedupe topics on ${targetLabel} D1${dryRun ? ' (DRY RUN)' : ''} ===\n`);

interface Row {
  id: number;
  title: string;
  status: string;
}

// 全議題取得（順序: id ASC で古い議題が「正本」になる）
const json = execSync(
  `npx wrangler d1 execute ai-roundtable ${target} --command "SELECT id, title, status FROM topics ORDER BY id ASC" --json`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] },
);
const data = JSON.parse(json) as Array<{ results?: Row[] }>;
const rows = data[0]?.results ?? [];

console.log(`Total topics: ${rows.length}\n`);

const survivors: string[] = []; // 採用済みタイトル（古い順、自分より前のものとだけ比較）
const rejects: Array<{ id: number; title: string; matchedWith: string; sim: number }> = [];

for (const row of rows) {
  if (row.status !== 'pending') {
    survivors.push(row.title);
    continue;
  }
  const dup = isDuplicateTitle(row.title, survivors);
  if (dup.duplicate) {
    rejects.push({
      id: row.id,
      title: row.title,
      matchedWith: dup.matchedWith ?? '',
      sim: dup.similarity ?? 0,
    });
  } else {
    survivors.push(row.title);
  }
}

console.log(`Pending dups to reject: ${rejects.length}\n`);
for (const r of rejects) {
  console.log(`  #${r.id} "${r.title}"`);
  console.log(`    ≈ "${r.matchedWith}" (sim=${r.sim.toFixed(2)})`);
}

if (rejects.length === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

if (dryRun) {
  console.log('\n(dry run, no changes applied)');
  process.exit(0);
}

const sql = rejects.map((r) => `UPDATE topics SET status='rejected' WHERE id=${r.id};`).join('\n');
const dataDir = join(ROOT, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const sqlPath = join(dataDir, 'dedupe-topics.sql');
writeFileSync(sqlPath, sql + '\n', 'utf-8');

console.log(`\nApplying ${rejects.length} rejections...\n`);
execSync(`npx wrangler d1 execute ai-roundtable ${target} --file "${sqlPath}"`, { stdio: 'inherit' });
console.log('\n✓ Done.');
