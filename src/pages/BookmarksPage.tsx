import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { TurnList } from '../components/TurnList';
import type { Message } from '../types';
import { bookmarks, type BookmarkRef } from '../utils/bookmarks';

interface Loaded {
  topicTitleById: Record<number, string>;
  messagesByTopic: Record<number, Message[]>;
}

export function BookmarksPage() {
  const [refs, setRefs] = useState<BookmarkRef[]>([]);
  const [loaded, setLoaded] = useState<Loaded>({ topicTitleById: {}, messagesByTopic: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const list = bookmarks.list();
    setRefs(list);

    if (list.length === 0) {
      setLoading(false);
      return;
    }

    const topicIds = Array.from(new Set(list.map((r) => r.topic_id)));
    Promise.all(topicIds.map((id) => api.topic(id).catch(() => null)))
      .then((results) => {
        const titles: Record<number, string> = {};
        const msgs: Record<number, Message[]> = {};
        for (const r of results) {
          if (!r) continue;
          titles[r.topic.id] = r.topic.title;
          msgs[r.topic.id] = r.messages;
        }
        setLoaded({ topicTitleById: titles, messagesByTopic: msgs });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="loading">Loading…</p>;
  if (error) return <p className="error">エラー: {error}</p>;

  if (refs.length === 0) {
    return (
      <>
        <div className="archive-head">
          <h2>ブックマーク</h2>
          <p className="archive-sub">気になった発言の ☆ をタップすると、ここに保存されます。</p>
        </div>
        <p className="empty">ブックマークはまだありません</p>
      </>
    );
  }

  // (topic_id, turn_no) で対応する Message を引いてリスト化
  const items: Message[] = [];
  for (const r of refs) {
    const msg = loaded.messagesByTopic[r.topic_id]?.find((m) => m.turn_no === r.turn_no);
    if (msg) items.push(msg);
  }

  // topic_id ごとにグループ化
  const groups = new Map<number, Message[]>();
  for (const m of items) {
    if (!groups.has(m.topic_id)) groups.set(m.topic_id, []);
    groups.get(m.topic_id)!.push(m);
  }

  return (
    <>
      <div className="archive-head">
        <h2>ブックマーク</h2>
        <p className="archive-sub">{refs.length}件 保存中</p>
      </div>

      {Array.from(groups.entries()).map(([topicId, msgs]) => (
        <section key={topicId} className="bookmark-group">
          <h3 className="bookmark-group-title">
            <Link to={`/topic/${topicId}`}>
              #{topicId} {loaded.topicTitleById[topicId] ?? '(議題情報を取得できません)'}
            </Link>
          </h3>
          <TurnList messages={msgs.sort((a, b) => a.turn_no - b.turn_no)} />
        </section>
      ))}
    </>
  );
}
