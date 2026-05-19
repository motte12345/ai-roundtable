/**
 * ローカル PoC: 1議題を完走させて JSON 出力する。
 * Workers 本番ロジックを共有 (workers/lib/) しているので、
 * ここで動けば Workers でも基本的に動く。
 *
 * 使い方:
 *   npm run discuss              # data/topics.json から1つランダム選択
 *   npm run discuss -- --id 5    # 議題ID指定
 *   npm run discuss -- --title "猫と犬..."   # タイトル指定（新規議題）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { runOneTurn, TOTAL_TURNS, TURN_PLAN } from '../workers/lib/discussion.js';
import type { ProviderEnv } from '../workers/lib/providers.js';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const env: ProviderEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
};

interface Topic {
  id: number;
  title: string;
  genre?: string;
}

interface TurnResult {
  turn_no: number;
  speaker: string;
  provider: string;
  model: string;
  content: string;
  created_at: number;
}

interface RunResult {
  topic: Topic;
  started_at: number;
  completed_at: number;
  turns: TurnResult[];
}

function loadTopics(): Topic[] {
  const raw = readFileSync(join(ROOT, 'data', 'topics.json'), 'utf-8');
  return JSON.parse(raw) as Topic[];
}

function pickTopic(topics: Topic[], args: string[]): Topic {
  const idArg = args.indexOf('--id');
  if (idArg >= 0) {
    const id = Number(args[idArg + 1]);
    const t = topics.find((x) => x.id === id);
    if (!t) throw new Error(`Topic id=${id} not found`);
    return t;
  }
  const titleArg = args.indexOf('--title');
  if (titleArg >= 0) {
    return { id: 0, title: args[titleArg + 1] ?? 'Untitled' };
  }
  return topics[Math.floor(Math.random() * topics.length)];
}

async function main() {
  const args = process.argv.slice(2);
  const topics = loadTopics();
  const topic = pickTopic(topics, args);

  console.log(`\n=========================================`);
  console.log(`Topic #${topic.id}: ${topic.title}`);
  console.log(`=========================================`);

  const startedAt = Date.now();
  const turns: TurnResult[] = [];

  for (let i = 1; i <= TOTAL_TURNS; i++) {
    const speaker = TURN_PLAN[i - 1];
    console.log(`\n--- Turn ${i}/${TOTAL_TURNS} [${speaker}] ---`);
    try {
      const r = await runOneTurn({
        topic: { id: topic.id, title: topic.title },
        turnNo: i,
        prevTurns: turns.map((t) => ({
          turn_no: t.turn_no,
          speaker: t.speaker as 'host' | 'optimist' | 'skeptic' | 'zen',
          content: t.content,
        })),
        env,
      });
      console.log(`[${r.speaker} via ${r.provider}/${r.model}] ${r.content}`);
      turns.push({
        turn_no: i,
        speaker: r.speaker,
        provider: r.provider,
        model: r.model,
        content: r.content,
        created_at: Date.now(),
      });
    } catch (err) {
      console.error(`Turn ${i} failed:`, err);
      throw err;
    }
  }

  const result: RunResult = {
    topic,
    started_at: startedAt,
    completed_at: Date.now(),
    turns,
  };

  const runsDir = join(ROOT, 'data', 'runs');
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(runsDir, `${ts}-topic-${topic.id}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`\n=========================================`);
  console.log(`✓ Discussion complete (${turns.length} turns)`);
  console.log(`  Saved: ${outPath}`);
  console.log(`=========================================\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
