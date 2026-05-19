import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { SPEAKER_META, type Message, type Speaker } from '../types';
import { splitParagraphs } from '../utils/format-content';

interface CharacterStats {
  total_messages: number;
  total_topics: number;
  avg_length: number;
}

interface CharacterMessage extends Message {
  topic_title: string;
}

interface CharacterData {
  speaker: string;
  stats: CharacterStats;
  recent_messages: CharacterMessage[];
  frequent_words: Array<{ word: string; count: number }>;
}

const VALID_SPEAKERS: Speaker[] = ['host', 'optimist', 'skeptic', 'zen'];

const ROLE_DESCRIPTION: Record<Speaker, string> = {
  optimist: '可能性を語る楽観派。世界はそもそも面白い方向に進むと信じている。',
  skeptic: '前提を疑う懐疑派。妥協と無難を最も嫌う。',
  zen: '俯瞰派。両者を整理した上で、メタ視点での一刺しを入れる。',
  host: '司会。議題を提示し、議論をまとめ、次議題を提案する。',
};

export function CharacterPage() {
  const { speaker } = useParams<{ speaker: string }>();
  const [data, setData] = useState<CharacterData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!speaker || !VALID_SPEAKERS.includes(speaker as Speaker)) {
      setError('Invalid character');
      return;
    }
    setData(null);
    setError(null);
    api.character(speaker).then(setData).catch((e) => setError(e.message));
  }, [speaker]);

  if (error) return <p className="error">エラー: {error}</p>;
  if (!data) return <p className="loading">Loading…</p>;

  const meta = SPEAKER_META[data.speaker as Speaker];
  const role = ROLE_DESCRIPTION[data.speaker as Speaker];

  return (
    <>
      <div className="character-head" style={{ borderColor: meta.color }}>
        <span className="character-icon" style={{ color: meta.color }}>
          {meta.icon}
        </span>
        <div>
          <h2 className="character-name" style={{ color: meta.color }}>
            {meta.label}
          </h2>
          <p className="character-role">{meta.role}</p>
        </div>
      </div>

      <p className="character-desc">{role}</p>

      <section className="character-stats">
        <div className="stat-card">
          <div className="stat-num">{data.stats.total_messages}</div>
          <div className="stat-label">総発言数</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{data.stats.total_topics}</div>
          <div className="stat-label">参加議題数</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{data.stats.avg_length}</div>
          <div className="stat-label">平均文字数</div>
        </div>
      </section>

      {data.frequent_words.length > 0 && (
        <section className="frequent-words">
          <h3 className="section-title">よく使う言葉</h3>
          <div className="word-cloud">
            {data.frequent_words.map((w) => (
              <span
                key={w.word}
                className="word-chip"
                style={{
                  fontSize: `${12 + Math.min(w.count, 20)}px`,
                  borderColor: meta.color,
                }}
              >
                {w.word}
                <span className="word-count">{w.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="section-title">最近の発言</h3>
        <div className="character-messages">
          {data.recent_messages.slice(0, 10).map((m) => (
            <article
              key={m.id}
              className="character-msg"
              style={{ borderLeftColor: meta.color }}
            >
              <header className="character-msg-head">
                <Link to={`/topic/${m.topic_id}`} className="character-msg-topic">
                  #{m.topic_id} {m.topic_title}
                </Link>
                <span className="character-msg-meta">Turn {m.turn_no}</span>
              </header>
              <div className="character-msg-body">
                {splitParagraphs(m.content).map((p, i) => (
                  <p key={i} className="turn-paragraph">{p}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <nav className="character-nav">
        <span className="character-nav-label">他のキャラ:</span>
        {VALID_SPEAKERS.filter((s) => s !== data.speaker).map((s) => {
          const m = SPEAKER_META[s];
          return (
            <Link
              key={s}
              to={`/character/${s}`}
              className="character-nav-link"
              style={{ borderColor: m.color, color: m.color }}
            >
              {m.icon} {m.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
