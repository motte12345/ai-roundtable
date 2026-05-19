import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import type { Topic } from '../types';

export function Sidebar() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const location = useLocation();

  useEffect(() => {
    api.recent(10).then((r) => setTopics(r.topics)).catch(() => setTopics([]));
  }, []);

  return (
    <aside className="sidebar">
      <h2 className="sidebar-title">議題一覧</h2>
      <nav>
        <Link to="/" className={`sidebar-item ${location.pathname === '/' ? 'active' : ''}`}>
          <span className="sidebar-dot live" />
          <span>進行中</span>
        </Link>
        {topics === null && <div className="sidebar-loading">Loading…</div>}
        {topics !== null && topics.length === 0 && (
          <div className="sidebar-empty">まだ議題がありません</div>
        )}
        {topics?.map((t) => (
          <Link
            key={t.id}
            to={`/topic/${t.id}`}
            className={`sidebar-item ${location.pathname === `/topic/${t.id}` ? 'active' : ''}`}
            title={t.title}
          >
            <span className="sidebar-no">#{t.id}</span>
            <span className="sidebar-title-text">{t.title}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
