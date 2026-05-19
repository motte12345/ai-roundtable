/**
 * 既存の audio_path が NULL の messages に対し、Workers AI MeloTTS で音声を生成し
 * R2 にアップロードして audio_path を更新する。
 *
 * Cloudflare REST API 経由なので、以下の環境変数が必要:
 *   CLOUDFLARE_ACCOUNT_ID  - https://dash.cloudflare.com の右下に表示される
 *   CLOUDFLARE_API_TOKEN   - 「Workers AI:Edit」「Workers R2 Storage:Edit」「D1:Edit」権限のカスタムトークン
 *
 * 使い方:
 *   npm run backfill:audio -- --remote
 *   npm run backfill:audio -- --remote --limit 50    # 件数制限（デフォルト: 全件）
 *
 * 注意:
 *   - Workers AI 無料枠 10K neurons/day を意識する。1メッセージで数百〜千 neurons 想定
 *   - ペースを抑えるため呼び出し間に 2 秒待機
 */
import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { audioPathFor, buildSpeechText } from '../workers/lib/tts.js';

loadEnv();

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const target = remote ? '--remote' : '--local';
const targetLabel = remote ? 'REMOTE' : 'LOCAL';

const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : Infinity;

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BUCKET = 'ai-roundtable-audio';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env');
  process.exit(1);
}

console.log(`\n=== Backfill audio on ${targetLabel} D1 (limit=${Number.isFinite(limit) ? limit : 'all'}) ===\n`);

interface MessageRow {
  id: number;
  topic_id: number;
  turn_no: number;
  speaker: string;
  content: string;
}

// 1. NULL の audio_path を持つ messages を取得（古い順）
const selectCmd = `npx wrangler d1 execute ai-roundtable ${target} --command "SELECT id, topic_id, turn_no, speaker, content FROM messages WHERE audio_path IS NULL ORDER BY id ASC" --json`;
const json = execSync(selectCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });
const data = JSON.parse(json) as Array<{ results?: MessageRow[] }>;
const rows = (data[0]?.results ?? []).slice(0, limit);

console.log(`Found ${rows.length} messages without audio.\n`);

if (rows.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

// 2. 各メッセージを処理
const TTS_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/myshell-ai/melotts`;
let success = 0;
let failed = 0;

for (const row of rows) {
  process.stdout.write(`  #${row.id} [topic ${row.topic_id} turn ${row.turn_no} ${row.speaker}] → `);

  const speechText = buildSpeechText(row.speaker, row.content);
  const safeText = speechText.slice(0, 500);

  // TTS 生成
  const ttsRes = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: safeText, lang: 'jp' }),
  });

  if (!ttsRes.ok) {
    const errBody = await ttsRes.text();
    console.log(`tts FAIL (${ttsRes.status}): ${errBody.slice(0, 100)}`);
    failed++;
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }

  const ttsJson = (await ttsRes.json()) as { result?: { audio?: string }; success?: boolean };
  const b64 = ttsJson.result?.audio;
  if (!b64) {
    console.log('no audio in response');
    failed++;
    continue;
  }

  // base64 → Buffer
  const bytes = Buffer.from(b64, 'base64');
  const path = audioPathFor(row.topic_id, row.turn_no);

  // R2 にアップロード（REST API: PUT /accounts/{id}/r2/buckets/{bucket}/objects/{key}）
  const r2Url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${path}`;
  const r2Res = await fetch(r2Url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'audio/mpeg',
    },
    body: new Uint8Array(bytes),
  });

  if (!r2Res.ok) {
    const errBody = await r2Res.text();
    console.log(`r2 FAIL (${r2Res.status}): ${errBody.slice(0, 100)}`);
    failed++;
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }

  // D1 更新
  const updateCmd = `npx wrangler d1 execute ai-roundtable ${target} --command "UPDATE messages SET audio_path = '${path}' WHERE id = ${row.id}"`;
  execSync(updateCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });

  console.log(`OK (${(bytes.length / 1024).toFixed(1)} KB)`);
  success++;

  // ペース制御
  await new Promise((r) => setTimeout(r, 2000));
}

console.log(`\n✓ Done. Success: ${success}, Failed: ${failed}`);
