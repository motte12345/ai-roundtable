/**
 * Cloudflare Turnstile 検証ヘルパ。
 * フロントから受け取ったトークンを Cloudflare に検証要求する。
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface VerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

export interface VerifyResult {
  ok: boolean;
  errors?: string[];
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp?: string,
): Promise<VerifyResult> {
  if (!token || !secret) {
    return { ok: false, errors: ['missing-token-or-secret'] };
  }

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) {
      return { ok: false, errors: [`http-${res.status}`] };
    }
    const data = (await res.json()) as VerifyResponse;
    if (data.success) return { ok: true };
    return { ok: false, errors: data['error-codes'] ?? ['unknown'] };
  } catch (e) {
    return { ok: false, errors: [`network: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

/**
 * IP アドレスをハッシュ化（重複投票検知用、平文IPはDBに残さない）。
 * SHA-256("ai-roundtable-vote:" + ip) の hex 文字列。
 */
export async function hashVoter(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`ai-roundtable-vote:${ip}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
