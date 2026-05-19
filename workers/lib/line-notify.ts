/**
 * LINE Messaging API 経由の Push Message 送信。
 * line-notify プロジェクトと同じチャネルを共用する想定。
 */
import type { DB } from './db.js';

interface SendOptions {
  token: string;
  userId: string;
  message: string;
}

export async function sendLinePush(opts: SendOptions): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify({
      to: opts.userId,
      messages: [{ type: 'text', text: opts.message.slice(0, 5000) }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push failed: HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * 同じエラーが連続発生してもうるさくないよう、24時間に1回までしか通知しない。
 * meta テーブルに `last_notify:{key}` で記録。
 */
export async function notifyOnce(
  db: DB,
  key: string,
  message: string,
  env: { LINE_CHANNEL_TOKEN?: string; LINE_USER_ID?: string },
  now: number,
): Promise<boolean> {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_USER_ID) {
    console.warn('[line-notify] secrets not set, skipping');
    return false;
  }

  const metaKey = `last_notify:${key}`;
  const lastStr = await db.getMeta(metaKey);
  const last = lastStr ? Number(lastStr) : 0;
  const ONE_DAY = 24 * 3600;
  if (now - last < ONE_DAY) {
    console.log(`[line-notify] suppressed (already sent within 24h): ${key}`);
    return false;
  }

  try {
    await sendLinePush({
      token: env.LINE_CHANNEL_TOKEN,
      userId: env.LINE_USER_ID,
      message,
    });
    await db.setMeta(metaKey, String(now), now);
    return true;
  } catch (e) {
    console.error('[line-notify] send failed:', e);
    return false;
  }
}
