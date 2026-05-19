/**
 * TTS 生成の日次予算トラッカー。
 *
 * Workers AI 無料枠 10K neurons/day を超えないよう、保守的な予算管理を行う。
 * 各呼び出し前に「予算を予約」する形で、超過時は呼び出しを抑止する。
 *
 * 設計:
 *   - 日次キー `tts_neurons:YYYY-MM-DD`(UTC) に累積 neuron 推定値を記録
 *   - 1コールあたりの neuron 数は不明なので**保守的見積もり**で計算
 *   - 見積もりと予算は meta テーブルで実行時上書き可（再デプロイ不要）
 *
 * 運用:
 *   - 数日運用して Cloudflare Workers AI ダッシュボードで実 neuron 消費を確認
 *   - `tts_neurons_per_call` を実測値に下げる → 1日に生成できる音声が増える
 *   - `tts_daily_budget` を引き上げる → ただし 10K を超えると課金リスク（Workers Paid 加入時のみ）
 *
 * 一時的に TTS を完全に止めたい場合:
 *   `INSERT OR REPLACE INTO meta(key,value,updated_at) VALUES('tts_daily_budget','0', strftime('%s','now'))`
 */
import type { DB } from './db.js';

/** デフォルト: 1コール = 1000 neurons と仮定（保守的）。実測後に下げる想定 */
const DEFAULT_NEURONS_PER_CALL = 1000;

/** デフォルト日次予算: 8000 neurons (= 無料枠 10K の 80%) */
const DEFAULT_DAILY_BUDGET = 8000;

const META_KEY_PER_CALL = 'tts_neurons_per_call';
const META_KEY_DAILY_BUDGET = 'tts_daily_budget';

function getUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function dailyMetaKey(): string {
  return `tts_neurons:${getUtcDateKey()}`;
}

async function getOverridable(db: DB, key: string, fallback: number): Promise<number> {
  const v = await db.getMeta(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface BudgetSnapshot {
  date: string;
  used: number;
  budget: number;
  per_call_estimate: number;
  remaining_calls: number;
}

export async function getBudgetSnapshot(db: DB): Promise<BudgetSnapshot> {
  const date = getUtcDateKey();
  const used = Number((await db.getMeta(dailyMetaKey())) ?? '0');
  const budget = await getOverridable(db, META_KEY_DAILY_BUDGET, DEFAULT_DAILY_BUDGET);
  const perCall = await getOverridable(db, META_KEY_PER_CALL, DEFAULT_NEURONS_PER_CALL);
  const remaining = Math.max(0, Math.floor((budget - used) / Math.max(1, perCall)));
  return {
    date,
    used,
    budget,
    per_call_estimate: perCall,
    remaining_calls: remaining,
  };
}

/**
 * 1コール分の予算を予約する。成功時は予約済 neurons を加算してカウンタ更新、
 * 残量不足なら ok=false。
 */
export async function tryReserveTtsBudget(db: DB): Promise<{
  ok: boolean;
  used: number;
  budget: number;
  per_call_estimate: number;
}> {
  const budget = await getOverridable(db, META_KEY_DAILY_BUDGET, DEFAULT_DAILY_BUDGET);
  const perCall = await getOverridable(db, META_KEY_PER_CALL, DEFAULT_NEURONS_PER_CALL);
  const key = dailyMetaKey();
  const used = Number((await db.getMeta(key)) ?? '0');

  if (used + perCall > budget) {
    return { ok: false, used, budget, per_call_estimate: perCall };
  }

  const newUsed = used + perCall;
  await db.setMeta(key, String(newUsed), Math.floor(Date.now() / 1000));
  return { ok: true, used: newUsed, budget, per_call_estimate: perCall };
}
