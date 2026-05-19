import { useEffect, useState } from 'react';
import { api } from '../api';
import { Countdown } from '../components/Countdown';
import { HighlightsBox } from '../components/HighlightsBox';
import { HostMemo } from '../components/HostMemo';
import { ShareButtons } from '../components/ShareButtons';
import { Summary } from '../components/Summary';
import { TopicHeader } from '../components/TopicHeader';
import { TTSToolbar } from '../components/TTSToolbar';
import { TurnList } from '../components/TurnList';
import type { Message, Topic } from '../types';

export function CurrentPage() {
  const [data, setData] = useState<{ topic: Topic | null; messages: Message[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .current()
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch((e) => !cancelled && setError(e.message));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error) return <p className="error">エラー: {error}</p>;
  if (!data) return <p className="loading">Loading…</p>;
  if (!data.topic) return <p className="empty">議論はまだ始まっていません</p>;

  const lastTurnAt = data.messages[data.messages.length - 1]?.created_at ?? data.topic.started_at;
  const isActive = data.topic.status === 'active';
  const shareUrl = `https://roundtable.simtool.dev/topic/${data.topic.id}`;
  const shareText = `「${data.topic.title}」AIたちの議論を見る`;

  return (
    <>
      <TopicHeader topic={data.topic} />
      {isActive && (
        <div className="active-meta">
          <Countdown lastTurnAt={lastTurnAt} />
        </div>
      )}
      <HostMemo memo={data.topic.host_memo} />
      <Summary messages={data.messages} />
      <HighlightsBox highlightsJson={data.topic.highlights} messages={data.messages} />
      <TTSToolbar messages={data.messages} />
      <TurnList messages={data.messages} />
      <ShareButtons text={shareText} url={shareUrl} />
    </>
  );
}
