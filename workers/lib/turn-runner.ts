/**
 * Cron 1回の発火で「ターン1つ進める」を担う高水準ロジック。
 * - active な議題がなければ pending から1つ選んで開始
 * - 議題が完了したら Host 提案候補をパースしてキューに投入
 */
import { DB } from './db.js';
import { runOneTurn, TOTAL_TURNS } from './discussion.js';
import { inferGenre, isValidGenre, type Genre } from './genre-infer.js';
import { notifyOnce } from './line-notify.js';
import type { Speaker } from './prompts.js';
import type { ProviderEnv } from './providers.js';
import { generateHighlights } from './highlights.js';
import { generateHostMemo } from './host-memo.js';
import { generateSeoTitle } from './seo-title.js';
import { buildSpeechText, generateAndStoreTts, type TtsEnv } from './tts.js';
import { tryReserveTtsBudget } from './tts-budget.js';
import { isDuplicateTitle, isThemeOverloaded } from './topic-similarity.js';
import { createSession, postRecord, buildPostChunks, type BskyPostRef } from './bluesky.js';

/** 議題ページの公開 URL ベース（Bluesky 投稿のリンク用） */
const TOPIC_URL_BASE = 'https://roundtable.simtool.dev/topic';

/** Host closing 用コンテキストのサイズ */
const RECENT_TITLES_LIMIT = 12;
const PENDING_TITLES_LIMIT = 20;

interface NotifyEnv {
  LINE_CHANNEL_TOKEN?: string;
  LINE_USER_ID?: string;
}

interface BlueskyEnv {
  BLUESKY_IDENTIFIER?: string;
  BLUESKY_APP_PASSWORD?: string;
}

interface RunContext {
  db: DB;
  // env は ProviderEnv（LLM プロバイダ）+ NotifyEnv（LINE）+ TtsEnv（AI/R2、optional）
  // + BlueskyEnv（本編配信、optional）。各 optional 機能は env が無ければスキップ
  env: ProviderEnv & NotifyEnv & Partial<TtsEnv> & BlueskyEnv;
  now: number;
}

export interface TurnResult {
  status: string;
  topic_id?: number;
  turn_no?: number;
  speaker?: string;
  proposals_added?: number;
  proposals_skipped_dup?: number;
  proposals_skipped_theme?: number;
}

export async function advanceOneTurn(ctx: RunContext): Promise<TurnResult> {
  const { db, env, now } = ctx;

  let active = await db.getActiveTopic();

  // active がなければ pending から1つ採用（CAS で勝者だけが startTopic 成功）
  if (!active) {
    const next = await db.getNextPendingTopic();
    if (!next) {
      return { status: 'no_topic_available' };
    }
    const won = await db.startTopic(next.id, now);
    if (!won) {
      // 別の cron が先に取った。次回に任せる
      return { status: 'lost_start_race', topic_id: next.id };
    }
    active = { ...next, status: 'active', started_at: now, current_turn: 0 };
  }

  // 進行中のターン番号は messages の最大値+1（current_turn フィールドより信頼できる）
  const maxTurn = await db.getMaxTurnNoForTopic(active.id);
  const nextTurnNo = maxTurn + 1;

  if (nextTurnNo > TOTAL_TURNS) {
    await db.completeTopic(active.id, now);
    return { status: 'topic_already_done', topic_id: active.id };
  }

  // 既存メッセージ（履歴）を取得
  const prevMessages = await db.getMessagesByTopic(active.id);
  const prevTurns = prevMessages.map((m) => ({
    turn_no: m.turn_no,
    speaker: m.speaker as Speaker,
    content: m.content,
  }));

  // Host closing (turn 11) のみ、既存議題タイトルを参考情報として渡す。
  // Host が「直前議論からの派生」だけで候補を量産し、似たテーマが偏るのを防ぐ。
  let hostContext;
  if (nextTurnNo === TOTAL_TURNS) {
    const [recentTitles, pendingTitles] = await Promise.all([
      db.getRecentCompletedTitles(RECENT_TITLES_LIMIT),
      db.getPendingProposedTitles(PENDING_TITLES_LIMIT),
    ]);
    hostContext = { recentTitles, pendingTitles };
  }

  // ターン実行（LLM 呼び出し）
  // 失敗してもメッセージは未挿入のままなので、次の cron で同じ nextTurnNo で再試行される
  // 連続失敗回数を meta に記録し、3回連続したら LINE 通知
  let result;
  try {
    result = await runOneTurn({
      topic: { id: active.id, title: active.title },
      turnNo: nextTurnNo,
      prevTurns,
      env,
      hostContext,
    });
    // 成功したら失敗カウンタをリセット
    await db.setMeta(`fail_count:topic_${active.id}_turn_${nextTurnNo}`, '0', now);
  } catch (err) {
    const failKey = `fail_count:topic_${active.id}_turn_${nextTurnNo}`;
    const prevFailCount = Number((await db.getMeta(failKey)) ?? '0');
    const newFailCount = prevFailCount + 1;
    await db.setMeta(failKey, String(newFailCount), now);

    if (newFailCount >= 3) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await notifyOnce(
        db,
        `turn_fail_${active.id}_${nextTurnNo}`,
        `[ai-roundtable] Turn 失敗が${newFailCount}回連続\n議題: #${active.id} ${active.title}\nTurn ${nextTurnNo}\n${errMsg.slice(0, 300)}`,
        env,
        now,
      );
    }
    throw err;
  }

  // 永続化（UNIQUE 制約で同ターン二重投入を防ぐ）
  const insertedId = await db.addMessage({
    topic_id: active.id,
    turn_no: nextTurnNo,
    speaker: result.speaker,
    provider: result.provider,
    model: result.model,
    content: result.content,
    created_at: now,
  });

  if (insertedId === null) {
    // レース敗者: 別の cron が同じターンを先に書き込んだ
    return { status: 'lost_turn_race', topic_id: active.id, turn_no: nextTurnNo };
  }

  await db.incrementTopicTurn(active.id, nextTurnNo);
  await db.setMeta('last_cron_run_at', String(now), now);

  // Bluesky 本編配信。各ターンを「自分へのリプライ＝自己スレッド」として連投する。
  // best-effort: ここの例外（getMeta 含む）は全て握り潰し、議論ターン進行には波及させない。
  //   bluesky_enabled='0' で停止可。
  // 冪等性: addMessage の UNIQUE 制約に勝った instance だけがここに来る + 投稿済みは
  //   bluesky_uri で判定されるため、cron 二重発火でも二重投稿しない。
  // 既知の失敗モード: postRecord 成功 → updateMessageBskyRef 完了前に Worker がクラッシュした
  //   場合、その投稿は Bluesky 上に存在するが bluesky_uri は NULL のまま残る。次ターンは
  //   root/parent 欠落でスキップされ、スレッドはそのターンで途中終了する（best-effort 許容）。
  if (env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD) {
    try {
      if ((await db.getMeta('bluesky_enabled')) === '0') {
        console.log('[bluesky] disabled via meta flag, skip');
      } else {
        let rootRef: BskyPostRef | null = null;
        let parentRef: BskyPostRef | null = null;
        let canPost = true;

        // turn2 以降は root(turn1) と parent(turn N-1) の参照が揃って初めて投稿できる。
        // turn1 が未投稿（root欠落）なら以降のスレッドは作らない（orphan reply を散らさない）。
        if (nextTurnNo > 1) {
          rootRef = await db.getMessageBskyRef(active.id, 1);
          parentRef = await db.getMessageBskyRef(active.id, nextTurnNo - 1);
          if (!rootRef || !parentRef) {
            console.log(
              `[bluesky] missing thread ref (root=${!!rootRef} parent=${!!parentRef}) topic ${active.id} turn ${nextTurnNo}, skip`,
            );
            canPost = false;
          }
        }

        if (canPost) {
          // URL は入口(turn1)とシェア起点(最終turn)のみ付ける
          const includeUrl = nextTurnNo === 1 || nextTurnNo === TOTAL_TURNS;
          const topicUrl = includeUrl ? `${TOPIC_URL_BASE}/${active.id}` : undefined;
          // 長い発言（Skeptic/Zen は実測~500字）は複数チャンクに分割し、サブ投稿として
          // 連続 reply する。turn1 は必ず単一投稿（短い Host + リンク）なので root が一意。
          const chunks = buildPostChunks(result.speaker, result.content, topicUrl);
          const session = await createSession(
            env.BLUESKY_IDENTIFIER,
            env.BLUESKY_APP_PASSWORD,
          );
          const createdAt = new Date(now * 1000).toISOString();
          let root = rootRef; // turn1 は null → 最初の投稿が root になる
          let parent = parentRef; // turn1 は null
          let lastRef: BskyPostRef | null = null;
          for (const chunk of chunks) {
            const reply = root && parent ? { root, parent } : undefined;
            const ref = await postRecord(session, {
              text: chunk.text,
              facets: chunk.facets,
              createdAt,
              reply,
            });
            if (!root) root = ref; // turn1 の最初のサブ投稿をスレッド root に
            parent = ref; // 各サブ投稿は直前のサブ投稿への reply
            lastRef = ref;
          }
          // このターンの「最後のサブ投稿」を ref として保存（次ターンはここに reply する）
          if (lastRef) {
            await db.updateMessageBskyRef(insertedId, lastRef.uri, lastRef.cid);
          }
        }
      }
    } catch (e) {
      console.warn('[bluesky] error', e);
    }
  }

  // 音声生成（Workers AI MeloTTS）。失敗してもターン進行は止めない
  // 日次予算（デフォルト 8K neurons = 10K 無料枠の 80%）を超えたらスキップ
  if (env.AI && env.AUDIO) {
    const reservation = await tryReserveTtsBudget(db);
    if (!reservation.ok) {
      console.log(
        `[tts] daily budget exhausted, skip (used=${reservation.used}/${reservation.budget})`,
      );
    } else {
      try {
        const speechText = buildSpeechText(result.speaker, result.content);
        const audioPath = await generateAndStoreTts(
          speechText,
          active.id,
          nextTurnNo,
          { AI: env.AI, AUDIO: env.AUDIO },
        );
        if (audioPath) {
          await db.updateMessageAudioPath(insertedId, audioPath);
        }
      } catch (e) {
        console.warn('[tts] error', e);
      }
    }
  }

  // 最終ターンなら議題を completed に + Host 提案を抽出してキュー投入
  if (nextTurnNo === TOTAL_TURNS) {
    await db.completeTopic(active.id, now);

    // SEO タイトル生成（失敗しても議題完了は止まらない）
    try {
      const seoTitle = await generateSeoTitle(active.title, env);
      if (seoTitle) {
        await db.updateSeoTitle(active.id, seoTitle);
      }
    } catch (e) {
      console.warn('[seo-title] error', e);
    }

    // ハイライト生成 + 司会のひとこと（どちらも最終ターン含む全発言を渡す）
    const allMessages = [
      ...prevTurns,
      { turn_no: nextTurnNo, speaker: result.speaker, content: result.content },
    ];
    try {
      const highlights = await generateHighlights(active.title, allMessages, env);
      if (highlights) {
        await db.updateHighlights(active.id, JSON.stringify(highlights));
      }
    } catch (e) {
      console.warn('[highlights] error', e);
    }
    try {
      const memo = await generateHostMemo(active.title, allMessages, env);
      if (memo) {
        await db.updateHostMemo(active.id, memo);
      }
    } catch (e) {
      console.warn('[host-memo] error', e);
    }

    const proposals = extractNextTopicProposals(result.content);

    // 既存議題タイトルを取得して重複検知に使う
    const existingTitles = await db.getAllTopicTitles();
    // pending 中の Host 提案のみ別途取得（主題過負荷チェックは「これから消化される候補プール」を見る）
    const pendingTitlesForTheme = await db.getPendingProposedTitles(PENDING_TITLES_LIMIT * 3);
    // 1バッチ内の重複も追跡する（Hostが3つの中に重複を出す可能性）
    const seenInBatch: string[] = [];
    let added = 0;
    let skippedDup = 0;
    let skippedTheme = 0;
    for (const p of proposals) {
      const allCandidates = [...existingTitles, ...seenInBatch];
      const dup = isDuplicateTitle(p.title, allCandidates);
      if (dup.duplicate) {
        console.log(`[skip-duplicate] "${p.title}" ≈ "${dup.matchedWith}" (sim=${dup.similarity?.toFixed(2)})`);
        skippedDup++;
        continue;
      }
      // 主題過負荷チェック: pending 中の同主題候補が既に3件以上ある場合は却下
      const themePool = [...pendingTitlesForTheme, ...seenInBatch];
      const over = isThemeOverloaded(p.title, themePool);
      if (over.overloaded) {
        console.log(
          `[skip-theme-overload] "${p.title}" theme=${over.theme} pending_count=${over.count}`,
        );
        skippedTheme++;
        continue;
      }
      const genre = p.genre ?? inferGenre(p.title);
      await db.addProposedTopic(p.title, genre, now);
      seenInBatch.push(p.title);
      added++;
    }
    return {
      status: 'topic_completed',
      topic_id: active.id,
      proposals_added: added,
      proposals_skipped_dup: skippedDup,
      proposals_skipped_theme: skippedTheme,
    };
  }

  return {
    status: 'turn_advanced',
    topic_id: active.id,
    turn_no: nextTurnNo,
    speaker: result.speaker,
  };
}

export interface ParsedProposal {
  title: string;
  genre: Genre | null;
}

/**
 * Host の closing 発言から「【次の議題候補】1. xxx [genre] 2. yyy [genre] 3. zzz [genre]」をパース。
 * `[ジャンル]` 表記が付いていれば取得、無ければ null（呼び出し側でフォールバック推定）。
 */
export function extractNextTopicProposals(closingText: string): ParsedProposal[] {
  const lines = closingText.split('\n');
  const proposals: ParsedProposal[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.includes('次の議題候補') || line.includes('次議題候補')) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    // "1. タイトル [genre]" / "1. タイトル" のいずれにも対応
    const match = line.match(/^\s*(?:[1-9]|[①-⑨])[.．、:：]?\s*(.+?)\s*$/);
    if (!match) continue;

    let rest = match[1].trim().replace(/[`*]/g, '').trim();

    // 末尾の `[xxx]` を取り出す
    let genre: Genre | null = null;
    const genreMatch = rest.match(/^(.*?)\s*\[([a-zA-Z_]+)\]\s*$/);
    if (genreMatch) {
      rest = genreMatch[1].trim();
      const candidate = genreMatch[2].toLowerCase();
      if (isValidGenre(candidate)) genre = candidate;
    }

    if (rest.length > 0 && rest.length <= 30) {
      proposals.push({ title: rest, genre });
    }
    if (proposals.length >= 3) break;
  }
  return proposals;
}
