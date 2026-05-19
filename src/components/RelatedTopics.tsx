import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Topic } from '../types';

interface Props {
  currentTopic: Topic;
}

/**
 * 同ジャンルの完了議題を3件ランダムに表示する（自分自身は除く）。
 * ジャンルが NULL の議題には表示しない。
 */
export function RelatedTopics({ currentTopic }: Props) {
  const [related, setRelated] = useState<Topic[]>([]);

  useEffect(() => {
    if (!currentTopic.genre) return;
    api
      .archive({ genre: currentTopic.genre, limit: 30 })
      .then((r) => {
        const candidates = r.topics.filter((t) => t.id !== currentTopic.id);
        // シャッフルして先頭3件
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        setRelated(candidates.slice(0, 3));
      })
      .catch(() => setRelated([]));
  }, [currentTopic.id, currentTopic.genre]);

  if (related.length === 0) return null;

  return (
    <section className="related">
      <h3 className="related-title">関連する議題</h3>
      <ul className="related-list">
        {related.map((t) => (
          <li key={t.id}>
            <Link to={`/topic/${t.id}`} className="related-link">
              <span className="related-no">#{t.id}</span>
              <span className="related-title-text">{t.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
