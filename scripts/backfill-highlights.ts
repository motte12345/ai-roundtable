/**
 * 既存の highlights が NULL の completed 議題に対し、Gemini で生成して UPDATE する。
 *
 * 使い方:
 *   npm run backfill:highlights -- --local
 *   npm run backfill:highlights -- --remote
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { generateHighlights, type HighlightInput } from '../workers/lib/highlights.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const target = remote ? '--remote' : '--local';
const targetLabel = remote ? 'REMOTE' : 'LOCAL';

if (!process.env.MISTRAL_API_KEY && !process.env.GROQ_API_KEY) {
  console.error('Neither MISTRAL_API_KEY nor GROQ_API_KEY set in .env');
  process.exit(1);
}

const usingMistral = Boolean(process.env.MISTRAL_API_KEY);
// Mistral Experiment tier は 2 RPM (30秒/req)。安全マージン込みで 35秒。
// Groq Llama 3.1 8B Instant は TPM 6000、1議題で約2700 token 消費するため 65秒待機。
const waitSeconds = usingMistral ? 35 : 65;

console.log(`\n=== Backfill highlights on ${targetLabel} D1 ===`);
console.log(`Provider: ${usingMistral ? 'mistral-small-latest (primary)' : 'groq llama-3.1-8b-instant'}`);
console.log(`Wait between calls: ${waitSeconds}s\n`);

interface TopicRow {
  id: number;
  title: string;
}

const topicsJson = execSync(
  `npx wrangler d1 execute ai-roundtable ${target} --command "SELECT id, title FROM topics WHERE status='completed' AND highlights IS NULL ORDER BY id" --json`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] },
);
const topics = (JSON.parse(topicsJson) as Array<{ results?: TopicRow[] }>)[0]?.results ?? [];
console.log(`Found ${topics.length} topics without highlights.\n`);

if (topics.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

const env = {
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
};
const updates: string[] = [];

for (const t of topics) {
  process.stdout.write(`  #${t.id} "${t.title}" → `);

  // 議論本文取得
  const msgJson = execSync(
    `npx wrangler d1 execute ai-roundtable ${target} --command "SELECT turn_no, speaker, content FROM messages WHERE topic_id=${t.id} ORDER BY turn_no" --json`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const messages = (JSON.parse(msgJson) as Array<{ results?: HighlightInput[] }>)[0]?.results ?? [];

  if (messages.length < 5) {
    console.log('(too few messages, skip)');
    continue;
  }

  // 最大3回リトライ。プロバイダ別の rate limit を考慮した待機時間
  let highlights = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    highlights = await generateHighlights(t.title, messages, env);
    if (highlights) break;
    if (attempt < 3) {
      const retryWait = waitSeconds + 5;
      process.stdout.write(`(retry ${attempt} in ${retryWait}s) `);
      await new Promise((r) => setTimeout(r, retryWait * 1000));
    }
  }

  if (highlights) {
    console.log(
      `s=${highlights.sharpest.turn_no} c=${highlights.constructive.turn_no} i=${highlights.illuminating.turn_no}`,
    );
    const escaped = JSON.stringify(highlights).replace(/'/g, "''");
    updates.push(`UPDATE topics SET highlights='${escaped}' WHERE id=${t.id};`);
  } else {
    console.log('(failed after retries)');
  }
  await new Promise((r) => setTimeout(r, waitSeconds * 1000));
}

console.log(`\nGenerated: ${updates.length} / ${topics.length}\n`);

if (updates.length === 0) {
  console.log('No updates.');
  process.exit(0);
}

const dataDir = join(ROOT, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const sqlPath = join(dataDir, 'backfill-highlights.sql');
writeFileSync(sqlPath, updates.join('\n') + '\n', 'utf-8');
console.log(`Wrote SQL: ${sqlPath}\n`);

console.log('Applying updates...\n');
execSync(`npx wrangler d1 execute ai-roundtable ${target} --file "${sqlPath}"`, { stdio: 'inherit' });
console.log('\n✓ Backfill complete.');
