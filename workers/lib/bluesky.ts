/**
 * Bluesky（AT Protocol）への本編配信クライアント。
 *
 * 単一アカウントが議論1議題（11発言）を「自分へのリプライ連鎖＝自己スレッド」として
 * 毎ターン連投する。各投稿の頭に話者プレフィックス（絵文字＋役職名）を付ける。
 *
 * - 認証は app password（OAuth は使わない）。createSession を毎回呼ぶ（JWT はキャッシュしない）。
 * - best-effort 前提。呼び出し側（turn-runner）が try/catch で握り潰す。
 * - Workers ランタイム互換（fetch / Intl.Segmenter / TextEncoder のみ使用）。
 *
 * 参照: https://docs.bsky.app/docs/advanced-guides/posts
 */

/** AT Protocol のポスト参照（reply の root/parent に使う） */
export interface BskyPostRef {
  uri: string;
  cid: string;
}

export interface BskySession {
  did: string;
  accessJwt: string;
}

/** app.bsky.richtext.facet（リンクをクリック可能にする） */
export interface BskyFacet {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: string; uri: string }>;
}

/** デフォルト PDS。セルフホスト等を使う場合はここを切替 */
const PDS = 'https://bsky.social';

/** Bluesky の投稿上限（書記素 = grapheme cluster で 300） */
const MAX_GRAPHEMES = 300;

/** 話者プレフィックス。色で人格を瞬時に判別できるようにする */
const SPEAKER_PREFIX: Record<string, string> = {
  host: '▣ Host:\n',
  optimist: '🟢 Optimist:\n',
  skeptic: '🔴 Skeptic:\n',
  zen: '🟣 Zen:\n',
};

// -------------------- テキスト整形（純粋関数・単体テスト可能） --------------------

/**
 * grapheme（書記素クラスタ）数を数える。
 * 絵文字・結合文字を1文字として扱うため Intl.Segmenter を使う。
 * Segmenter はインスタンス生成コストを避けるため呼び出しごとに作る（頻度は ≤1/15分）。
 */
function countGraphemes(text: string): number {
  // ロケールは grapheme 境界に影響しない（word/sentence のみロケール依存）ため undefined
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...seg.segment(text)].length;
}

/** grapheme 数で末尾を切り詰める（超過時のみ末尾に「…」を付ける） */
function trimToGraphemes(text: string, max: number): string {
  if (max <= 0) return '';
  // ロケールは grapheme 境界に影響しない（word/sentence のみロケール依存）ため undefined
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = [...seg.segment(text)].map((s) => s.segment);
  if (segments.length <= max) return text;
  return segments.slice(0, max - 1).join('') + '…';
}

/**
 * リンク用 facet を組む。byteStart/byteEnd は UTF-8 バイト基準。
 * 絵文字プレフィックスのバイト数を事前計算するとズレるため、
 * 「完成テキストを slice して TextEncoder で実測」する順序を必ず守る。
 */
function buildLinkFacet(fullText: string, url: string): BskyFacet {
  const encoder = new TextEncoder();
  const idx = fullText.lastIndexOf(url); // URL は末尾に置く前提
  const byteStart = encoder.encode(fullText.slice(0, idx)).length;
  const byteEnd = byteStart + encoder.encode(url).length;
  return {
    index: { byteStart, byteEnd },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
  };
}

/**
 * 1発言を Bluesky 投稿テキスト + facets に整形する。
 * topicUrl を渡すと末尾にリンクを付ける（turn1 / turn11 のみ想定）。
 */
export function buildPostText(
  speaker: string,
  content: string,
  topicUrl?: string,
): { text: string; facets?: BskyFacet[] } {
  const prefix = SPEAKER_PREFIX[speaker] ?? `${speaker}:\n`;
  const urlSection = topicUrl ? `\n\n${topicUrl}` : '';
  const available =
    MAX_GRAPHEMES - countGraphemes(prefix) - countGraphemes(urlSection);
  const trimmed = trimToGraphemes(content.trim(), available);
  const text = prefix + trimmed + urlSection;
  if (!topicUrl) return { text };
  return { text, facets: [buildLinkFacet(text, topicUrl)] };
}

// -------------------- AT Protocol HTTP --------------------

/** app password でセッションを作る。失敗時は throw（呼び出し側で握り潰す） */
export async function createSession(
  identifier: string,
  password: string,
): Promise<BskySession> {
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createSession HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { did?: string; accessJwt?: string };
  if (!data.did || !data.accessJwt) {
    throw new Error('createSession: response missing did/accessJwt');
  }
  return { did: data.did, accessJwt: data.accessJwt };
}

/**
 * ポストを1件作成する。reply を渡すと root/parent に連結（自己スレッド継続）。
 * 成功時に作成されたポストの {uri, cid} を返す（次ターンの parent になる）。
 */
export async function postRecord(
  session: BskySession,
  opts: {
    text: string;
    facets?: BskyFacet[];
    createdAt: string; // ISO8601
    reply?: { root: BskyPostRef; parent: BskyPostRef };
  },
): Promise<BskyPostRef> {
  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text: opts.text,
    createdAt: opts.createdAt,
    langs: ['ja'],
    ...(opts.facets && opts.facets.length > 0 ? { facets: opts.facets } : {}),
    ...(opts.reply ? { reply: opts.reply } : {}),
  };

  const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createRecord HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { uri?: string; cid?: string };
  if (!data.uri || !data.cid) {
    throw new Error('createRecord: response missing uri/cid');
  }
  return { uri: data.uri, cid: data.cid };
}
