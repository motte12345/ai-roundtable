import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Topic } from '../types';
import { genreLabel, GENRE_LABELS } from '../utils/genre';

const PAGE_SIZE = 20;

export function ArchivePage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ジャンル別件数取得
  useEffect(() => {
    api
      .genres()
      .then((r) => {
        const map: Record<string, number> = {};
        let total = 0;
        for (const c of r.counts) {
          const key = c.genre ?? '__other__';
          map[key] = c.count;
          total += c.count;
        }
        setCounts(map);
        setTotalCount(total);
      })
      .catch(() => {
        // 件数取得失敗は致命ではない
      });
  }, []);

  // 議題一覧取得（ジャンル変更時にリセット）
  useEffect(() => {
    setLoading(true);
    setError(null);
    setTopics([]);
    setCursor(null);
    api
      .archive({ limit: PAGE_SIZE, genre })
      .then((r) => {
        setTopics(r.topics);
        setCursor(r.next_cursor);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [genre]);

  const loadMore = () => {
    if (cursor === null || loading) return;
    setLoading(true);
    api
      .archive({ cursor, limit: PAGE_SIZE, genre })
      .then((r) => {
        setTopics((prev) => [...prev, ...r.topics]);
        setCursor(r.next_cursor);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <>
      <div className="archive-head">
        <h2>過去の議題</h2>
        <p className="archive-sub">これまでに完了した議論。クリックで全文を表示。</p>
      </div>

      <div className="genre-tabs">
        <button
          className={`genre-tab ${genre === null ? 'active' : ''}`}
          onClick={() => setGenre(null)}
        >
          すべて <span className="genre-count">{totalCount}</span>
        </button>
        {Object.keys(GENRE_LABELS).map((key) => (
          <button
            key={key}
            className={`genre-tab ${genre === key ? 'active' : ''}`}
            onClick={() => setGenre(key)}
          >
            {GENRE_LABELS[key]} <span className="genre-count">{counts[key] ?? 0}</span>
          </button>
        ))}
        {counts['__other__'] > 0 && (
          <button
            className={`genre-tab ${genre === '__other__' ? 'active' : ''}`}
            onClick={() => setGenre('__other__')}
          >
            その他（未分類） <span className="genre-count">{counts['__other__']}</span>
          </button>
        )}
      </div>

      {error && <p className="error">エラー: {error}</p>}

      {topics.length === 0 && !loading && !error && (
        <p className="empty">このジャンルの完了議題はまだありません</p>
      )}

      <ul className="archive-list">
        {topics.map((t) => (
          <li key={t.id} className="archive-item">
            <Link to={`/topic/${t.id}`} className="archive-link">
              <span className="archive-no">#{t.id}</span>
              <span className="archive-title">{t.title}</span>
              <span className="archive-genre">{genreLabel(t.genre)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {cursor !== null && (
        <button className="load-more" onClick={loadMore} disabled={loading}>
          {loading ? '読み込み中…' : 'もっと読み込む'}
        </button>
      )}
    </>
  );
}
