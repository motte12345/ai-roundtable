/**
 * Bluesky（AT Protocol）への本編配信クライアント。
 *
 * 単一アカウントが議論1議題（11発言）を「自分へのリプライ連鎖＝自己スレッド」として
 * 毎ターン連投する。各投稿の頭に話者プレフィックス（絵文字＋役職名）を付ける。
 *
 * - 認証は app password（OAuth は使わない）。createSession を毎回呼ぶ（JWT はキャッシュしない）。
 * - best-effort 前提。呼び出し側（turn-runner）が try/catch で握り潰す。
 * - Workers ランタイム互換（fetch / TextEncoder のみ使用）。
 *   ※ 文字数カウントは Intl.Segmenter ではなく Array.from（コードポイント）を使う。
 *     Segmenter は Workers 実機で grapheme を正しく数えなかった（countCodepoints 参照）。
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

/** app.bsky.richtext.facet（リンク・ハッシュタグをクリック/検索可能にする） */
export interface BskyFacet {
  index: { byteStart: number; byteEnd: number };
  // #link は uri、#tag は tag を持つ（型で取り違えを防ぐ）
  features: Array<
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  >;
}

/** デフォルト PDS。セルフホスト等を使う場合はここを切替 */
const PDS = 'https://bsky.social';

/** 1投稿あたりの目標長（コードポイント）。Bluesky 公式の compose 上限が 300 grapheme で、
 *  超えると公式アプリが "Show more" で表示クリップするため、それ未満に収める。
 *  ※ API（createRecord）自体は ~3000 バイトまで受けるが、可読性のため 300 を目標にする。 */
const MAX_LENGTH = 300;

/** 分割時の1サブ投稿あたり本文 budget。最長 prefix（🟢 Optimist（楽観派）:\n ≒17）+
 *  counter " (n/n)"(~6, n<10) を 300 から引いた安全値（17+270+6=293≤300）。 */
const CHUNK_CONTENT_BUDGET = 270;

/** 継続サブ投稿の先頭マーカー */
const CONT_PREFIX = '（続き）';

/** 文境界として優先する区切り文字（。！？等 → 読点の順で探す） */
const SENTENCE_BREAKS = ['。', '！', '？', '\n', '．', '!', '?'];

/** 話者プレフィックス。色＋英名＋日本語の立場で、誰のどんな立場の発言か一目で分かるようにする */
const SPEAKER_PREFIX: Record<string, string> = {
  host: '▣ Host（司会）:\n',
  optimist: '🟢 Optimist（楽観派）:\n',
  skeptic: '🔴 Skeptic（懐疑派）:\n',
  zen: '🟣 Zen（俯瞰派）:\n',
};

// -------------------- テキスト整形（純粋関数・単体テスト可能） --------------------

/**
 * コードポイント数で長さを数える。
 * NOTE: 当初 Intl.Segmenter(grapheme) を使ったが、Cloudflare Workers 上では
 * grapheme 境界データが不完全で実測の約半分しか数えず、trim/split が効かなかった
 * （Node ローカルでは正常 = 公式と実機の乖離）。日本語＋単一コードポイント絵文字
 * （🟢▣等）が対象なので、コードポイント数 ≒ grapheme 数で十分かつ移植性が高い。
 * Array.from はサロゲートペアをコードポイント単位で1要素にまとめる。
 */
function countCodepoints(text: string): number {
  return Array.from(text).length;
}

/** コードポイント数で末尾を切り詰める（超過時のみ末尾に「…」を付ける） */
function trimToLength(text: string, max: number): string {
  if (max <= 0) return '';
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  return cps.slice(0, max - 1).join('') + '…';
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
 * ハッシュタグ群の末尾セクション（`\n\n#tag1 #tag2 ...`）と、各タグの tag facet を組む。
 * baseText（タグより前の確定テキスト）からの UTF-8 バイトオフセットを構築しながら実測する。
 * tag facet の値は `#` を除いたタグ文字列、byte 範囲は `#tag`（# 込み）を指す。
 */
function buildTagSection(
  baseText: string,
  tags: string[],
): { section: string; facets: BskyFacet[] } {
  const encoder = new TextEncoder();
  const facets: BskyFacet[] = [];
  let section = '\n\n';
  tags.forEach((tag, i) => {
    if (i > 0) section += ' ';
    const byteStart = encoder.encode(baseText + section).length;
    const hashtag = `#${tag}`;
    section += hashtag;
    const byteEnd = byteStart + encoder.encode(hashtag).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
    });
  });
  return { section, facets };
}

/**
 * 本文を budget（コードポイント）以内のチャンクに分割する。
 * できるだけ文境界（。！？→読点）で切る。budget の 50% 以降で最後に見つかった
 * 区切りで切り、無ければ budget でハード分割する。
 */
function splitContent(content: string, budget: number): string[] {
  if (budget <= 0) throw new Error('splitContent: budget must be > 0');
  const segs = Array.from(content);
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
  hashtags?: string[],
): Array<{ text: string; facets?: BskyFacet[] }> {
  const prefix = SPEAKER_PREFIX[speaker] ?? `${speaker}:\n`;
  const body = content.trim();

  // turn1/11: 短い Host 発言 + リンク。リンク付き単一投稿として扱う（実測 ≤226字で収まる）。
  // turn1 のみ hashtags を末尾に付与（検索流入用、tag facet 付き）。
  if (topicUrl) {
    const urlSection = `\n\n${topicUrl}`;
    const tags = hashtags?.filter((t) => t.length > 0) ?? [];
    // 本文 budget は prefix + urlSection + （タグ込みの想定長）を 300 から引いた残り。
    // タグセクションの実長はトリム後の本文に依存するので、先に本文を確定させてから組む。
    const tagBudget = tags.length ? countCodepoints('\n\n' + tags.map((t) => `#${t}`).join(' ')) : 0;
    const available =
      MAX_LENGTH - countCodepoints(prefix) - countCodepoints(urlSection) - tagBudget;
    const base = prefix + trimToLength(body, available) + urlSection;
    const { section, facets: tagFacets } = tags.length
      ? buildTagSection(base, tags)
      : { section: '', facets: [] };
    const text = base + section;
    return [{ text, facets: [buildLinkFacet(text, topicUrl), ...tagFacets] }];
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

// -------------------- リトライ（一時的失敗対策） --------------------

/** 失敗時に attempts 回まで線形バックオフで再試行する汎用ヘルパー。 */
async function withRetry<T>(fn: () => Promise<T>, attempts: number, baseMs: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const more = i < attempts - 1;
      console.warn(`[bluesky] attempt ${i + 1}/${attempts} failed${more ? ', retrying' : ''}:`, e);
      if (more) {
        await new Promise((r) => setTimeout(r, baseMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

/** createSession を最大 attempts 回まで再試行。 */
export function createSessionWithRetry(
  identifier: string,
  password: string,
  attempts = 2,
): Promise<BskySession> {
  return withRetry(() => createSession(identifier, password), attempts, 800);
}

/**
 * postRecord を最大 attempts 回まで再試行する。**チャンク単位で呼ぶこと**
 * （ターン全体を再試行すると投稿済みチャンクが二重投稿になるため）。
 */
export function postRecordWithRetry(
  session: BskySession,
  opts: Parameters<typeof postRecord>[1],
  attempts = 3,
): Promise<BskyPostRef> {
  return withRetry(() => postRecord(session, opts), attempts, 600);
}
