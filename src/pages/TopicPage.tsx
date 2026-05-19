import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { HighlightsBox } from '../components/HighlightsBox';
import { HostMemo } from '../components/HostMemo';
import { RelatedTopics } from '../components/RelatedTopics';
import { ShareButtons } from '../components/ShareButtons';
import { Summary } from '../components/Summary';
import { TopicHeader } from '../components/TopicHeader';
import { TTSToolbar } from '../components/TTSToolbar';
import { TurnList } from '../components/TurnList';
import type { Message, Topic } from '../types';

export function TopicPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ topic: Topic; messages: Message[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError(null);
    api
      .topic(Number(id))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  // SEOタイトル（あれば）でブラウザのタブタイトルを更新
  useEffect(() => {
    if (!data) return;
    const t = data.topic.seo_title ?? data.topic.title;
    document.title = `${t} — AI Roundtable`;
    return () => {
      document.title = 'AI Roundtable';
    };
  }, [data]);

  if (error) return <p className="error">エラー: {error}</p>;
  if (!data) return <p className="loading">Loading…</p>;

  const shareUrl = `https://roundtable.simtool.dev/topic/${data.topic.id}`;
  const shareText = `「${data.topic.title}」AIたちの議論`;

  return (
    <>
      <TopicHeader topic={data.topic} />
      <HostMemo memo={data.topic.host_memo} />
      <Summary messages={data.messages} />
      <HighlightsBox highlightsJson={data.topic.highlights} messages={data.messages} />
      <TTSToolbar messages={data.messages} />
      <TurnList messages={data.messages} />
      <ShareButtons text={shareText} url={shareUrl} />
      <RelatedTopics currentTopic={data.topic} />
    </>
  );
}
