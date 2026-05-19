/**
 * 議論ターン進行の純粋ロジック。
 * scripts と workers の両方から参照される。
 */
import { SPEAKER_LABEL, SYSTEM_PROMPTS, type Speaker } from './prompts.js';
import {
  completeWithFallback,
  getProviderAssignment,
  type Message,
  type ProviderEnv,
} from './providers.js';

// 1議題11発言の固定構造
export const TURN_PLAN: Speaker[] = [
  'host',     // 1: 議題提示
  'optimist', // 2
  'skeptic',  // 3
  'zen',      // 4
  'optimist', // 5
  'skeptic',  // 6
  'zen',      // 7
  'optimist', // 8: 結論
  'skeptic',  // 9: 結論
  'zen',      // 10: 総括
  'host',     // 11: まとめ + 次議題提案
];

export const TOTAL_TURNS = TURN_PLAN.length;

export interface PrevTurn {
  turn_no: number;
  speaker: Speaker;
  content: string;
}

export interface TopicLite {
  id: number;
  title: string;
}

/**
 * Host closing 用の追加コンテキスト。
 * 「最近完了した議題」「pending キューにある候補」を Host に見せ、
 * 似たような主題ばかり提案されるのを抑える。
 */
export interface HostClosingContext {
  recentTitles: string[];
  pendingTitles: string[];
}

/**
 * 履歴を user メッセージ1本に統合。
 * - assistant ロールで他キャラ発言を渡すと役割崩壊が起きるため避ける
 * - Cerebras 8192 token 制限対応のため直近6発言のみ
 */
function buildHistory(
  turns: PrevTurn[],
  topic: TopicLite,
  speaker: Speaker,
  turnNo: number,
  hostContext?: HostClosingContext,
): Message[] {
  const recent = turns.slice(-6);
  const myLabel = SPEAKER_LABEL[speaker];

  let body = `議題: 「${topic.title}」\nTurn ${turnNo}/11\n\n`;

  if (recent.length > 0) {
    body += `## これまでの議論\n\n`;
    for (const t of recent) {
      const isMe = t.speaker === speaker;
      const tag = isMe
        ? `### ${SPEAKER_LABEL[t.speaker]}（あなた自身の過去発言 ← これを絶対にコピーしない）`
        : `### ${SPEAKER_LABEL[t.speaker]}（他キャラの発言 ← これをコピーしない、自分の意見として再生産しない）`;
      body += `${tag}\n${t.content}\n\n`;
    }
  }

  body += `---\n\n`;

  if (speaker === 'host' && turnNo === 1) {
    body += `あなたは Host です。**mode: opening**\n議題「${topic.title}」を提示してください。**100字以内**、本文のみ。`;
  } else if (speaker === 'host' && turnNo === 11) {
    body += `あなたは Host です。**mode: closing**\n\n`;
    if (hostContext && (hostContext.recentTitles.length || hostContext.pendingTitles.length)) {
      body += `## 既存議題一覧（次の候補は ここと主題がかぶってはいけない）\n\n`;
      if (hostContext.recentTitles.length) {
        body += `### 最近完了した議題\n`;
        for (const t of hostContext.recentTitles) body += `- ${t}\n`;
        body += `\n`;
      }
      if (hostContext.pendingTitles.length) {
        body += `### 既にキューに並んでいる候補\n`;
        for (const t of hostContext.pendingTitles) body += `- ${t}\n`;
        body += `\n`;
      }
      body +=
        `**上記リストと同じ主題語**（AI / 幸福 / 創造性 / 感情 / 意識 / 仮想空間 / 所有 / 努力 / 才能 / 友情 / 自由 / 倫理 等）` +
        `**を主軸とする候補は禁止**。上記リストに無い切り口の3候補を提案してください。\n\n`;
    }
    body += `上記の議論を踏まえ、システムプロンプトの指定形式（【まとめ】3点 + 【次の議題候補】3つ）で出力してください。コードブロック（\`\`\`）で囲まないこと。`;
  } else {
    body +=
      `あなたは **${myLabel}** です。あなたの番です。\n\n` +
      `### 出力ルール（厳守）\n` +
      `- **必ず150〜250字以内**で答える（300字を超えたら失格）\n` +
      `- 本文のみを出力（「${myLabel}:」のようなラベルや、\`[host]\`、\`[/optimist]\`、\`[realist]\` のようなタグは絶対に出力しない）\n` +
      `- **過去の自分の発言を一字一句コピーしない**。同じ論点を繰り返すなら、必ず違う言い回しで言い換え、加えて新しい角度を1つ追加\n` +
      `- **他キャラの発言をそのまま引用しない**。引用するなら「Optimist が〜と言ったが」のように明確に他者扱いし、その後で必ず自分の角度を述べる\n` +
      `- 他キャラ（Host / Optimist / Skeptic / Zen）になりきって代弁しない\n` +
      `- 司会進行や次の発言者の指名はしない（それは Host の役割）\n` +
      `- **必ず日本語で書く**（他言語の単語が混ざるのは禁止）\n\n` +
      `### 議論を盛り上げるために\n` +
      `- **両論併記の逃げを禁ずる**。「色々な意見がある」「個人による」「バランスが大事」のような無難な落とし所に逃げない\n` +
      `- 自分の立場を**明確に断定する**。曖昧さで丸めない\n` +
      `- 一般論より**具体例・比喩・身も蓋もない真実**を1つは盛り込む\n` +
      `- 相手の発言を**そのまま肯定して終わらない**（必ず自分の角度を加える）\n\n` +
      `### 読みやすさ\n` +
      `- 全体を**2〜3段落に分けて**出力する。段落の区切りには空行を入れる（実際に改行する）\n` +
      `- 1段落は2〜3文程度。長い文を1つの塊にしない\n` +
      `- 「\\n」のような文字列を本文に書かない（実際に改行キーで改行する）`;
  }

  return [{ role: 'user', content: body }];
}

export interface RunTurnInput {
  topic: TopicLite;
  turnNo: number;
  prevTurns: PrevTurn[];
  env: ProviderEnv;
  /** Host closing (turn 11) のみ参照。最近完了/pending タイトル一覧 */
  hostContext?: HostClosingContext;
}

export interface RunTurnOutput {
  speaker: Speaker;
  provider: string;
  model: string;
  content: string;
}

/**
 * 1ターン分の発言を生成する純粋関数。
 * 永続化・I/O は呼び出し側の責任。
 */
export async function runOneTurn(input: RunTurnInput): Promise<RunTurnOutput> {
  const { topic, turnNo, prevTurns, env, hostContext } = input;
  const speaker = TURN_PLAN[turnNo - 1];
  if (!speaker) throw new Error(`Invalid turnNo: ${turnNo}`);

  const systemPrompt = SYSTEM_PROMPTS[speaker];
  const { primary, fallback } = getProviderAssignment(speaker, env);
  const history = buildHistory(prevTurns, topic, speaker, turnNo, hostContext);

  const isHostClosing = speaker === 'host' && turnNo === 11;
  // Host は文体を安定させたいので低め、3キャラは表現の振れ幅を広げて「無難化」を避ける
  const temperature = speaker === 'host' ? 0.75 : 0.95;
  const res = await completeWithFallback(
    {
      systemPrompt,
      history,
      maxTokens: isHostClosing ? 500 : 350,
      temperature,
    },
    { primary, fallback },
  );

  return {
    speaker,
    provider: res.provider,
    model: res.model,
    content: res.text,
  };
}
