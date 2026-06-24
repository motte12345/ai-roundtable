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

/** 分割時の1サブ投稿あたり本文 budget。prefix(~12) + counter " (n/n)"(~6, n<10) を 300 から
 *  引いた安全値。実測 ~500字 → 最大2チャンクなので n は1桁、上限超過は起きない。 */
const CHUNK_CONTENT_BUDGET = 280;

/** 継続サブ投稿の先頭マーカー */
const CONT_PREFIX = '（続き）';

/** 文境界として優先する区切り文字（。！？等 → 読点の順で探す） */
const SENTENCE_BREAKS = ['。', '！', '？', '\n', '．', '!', '?'];

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
 * 本文を budget（書記素）以内のチャンクに分割する。
 * できるだけ文境界（。！？→読点）で切る。budget の 50% 以降で最後に見つかった
 * 区切りで切り、無ければ budget でハード分割する。
 */
function splitContent(content: string, budget: number): string[] {
  if (budget <= 0) throw new Error('splitContent: budget must be > 0');
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segs = [...seg.segment(content)].map((s) => s.segment);
  if (segs.length <= budget) {
    const single = content.trim();
    return single.length > 0 ? [single] : [];
  }

  const chunks: string[] = [];
  let i = 0;
  while (i < segs.length) {
    let end = Math.min(i + budget, segs.length);
    if (end < segs.length) {
      const window = segs.slice(i, end);
      const minCut = Math.floor(window.length * 0.5);
      let cut = -1;
      for (let j = window.length - 1; j >= minCut; j--) {
        if (SENTENCE_BREAKS.includes(window[j])) {
          cut = j;
          break;
        }
      }
      if (cut === -1) {
        for (let j = window.length - 1; j >= minCut; j--) {
          if (window[j] === '、') {
            cut = j;
            break;
          }
        }
      }
      if (cut !== -1) end = i + cut + 1;
    }
    const piece = segs.slice(i, end).join('').trim();
    if (piece.length > 0) chunks.push(piece);
    i = end;
  }
  return chunks;
}

/**
 * 1発言を Bluesky 投稿チャンク配列に整形する。長い発言は複数投稿に分割される
 * （呼び出し側がスレッドとして連投する）。
 * - topicUrl 付き（turn1/11 の短い Host 発言想定）: リンク付き単一投稿
 * - topicUrl なし（Skeptic/Zen 等）: 上限超過分を文境界で分割。先頭は話者プレフィックス、
 *   継続は `（続き）`、複数チャンク時は各末尾に ` (i/n)` を付ける
 */
export function buildPostChunks(
  speaker: string,
  content: string,
  topicUrl?: string,
): Array<{ text: string; facets?: BskyFacet[] }> {
  const prefix = SPEAKER_PREFIX[speaker] ?? `${speaker}:\n`;
  const body = content.trim();

  // turn1/11: 短い Host 発言 + リンク。リンク付き単一投稿として扱う（実測 ≤226字で収まる）。
  if (topicUrl) {
    const urlSection = `\n\n${topicUrl}`;
    const available =
      MAX_GRAPHEMES - countGraphemes(prefix) - countGraphemes(urlSection);
    const text = prefix + trimToGraphemes(body, available) + urlSection;
    return [{ text, facets: [buildLinkFacet(text, topicUrl)] }];
  }

  // それ以外: 上限超過分を文境界で分割してスレッド連投する。
  const pieces = splitContent(body, CHUNK_CONTENT_BUDGET);
  const n = pieces.length;
  return pieces.map((piece, i) => {
    const head = i === 0 ? prefix : CONT_PREFIX;
    const counter = n > 1 ? ` (${i + 1}/${n})` : '';
    return { text: head + piece + counter };
  });
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
