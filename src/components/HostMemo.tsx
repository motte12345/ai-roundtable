/**
 * 議題完了時に Host が書いた「ひとこと」(舞台裏メタコメント)を表示。
 * topic.host_memo が null なら何も描画しない。
 */
import { SPEAKER_META } from '../types';

interface Props {
  memo: string | null;
}

export function HostMemo({ memo }: Props) {
  if (!memo) return null;
  const meta = SPEAKER_META.host;
  return (
    <aside className="host-memo" aria-label="司会のひとこと">
      <span className="host-memo-icon" style={{ color: meta.color }}>
        {meta.icon}
      </span>
      <span className="host-memo-label">司会のひとこと</span>
      <p className="host-memo-text">{memo}</p>
    </aside>
  );
}
