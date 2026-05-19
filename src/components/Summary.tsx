import type { Message } from '../types';
import { extractSummary } from '../utils/format-content';

interface Props {
  messages: Message[];
}

/**
 * 完了議題の冒頭に「議論のまとめ（TL;DR）」を表示する。
 * Host の closing（turn 11）から【まとめ】セクションを切り出す。
 * Host のまとめが取れない or 議題未完了の場合は null を返す。
 */
export function Summary({ messages }: Props) {
  const closing = messages.find((m) => m.speaker === 'host' && m.turn_no === 11);
  if (!closing) return null;

  const summary = extractSummary(closing.content);
  if (!summary) return null;

  return (
    <aside className="summary-box">
      <h3 className="summary-title">議論のまとめ（TL;DR）</h3>
      <p className="summary-body">{summary}</p>
    </aside>
  );
}
