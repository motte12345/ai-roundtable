/**
 * 議題候補一覧 + 投票ページ。
 * Host が議論末尾で提案した次議題候補（pending かつ host_proposed）を一覧表示。
 * Cloudflare Turnstile + localStorage の二重チェックで投票スパムを抑制。
 *
 * 投票結果は cron の議題選択ロジックには影響しない（あくまで参考）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { TurnstileWidget, type TurnstileHandle } from '../components/TurnstileWidget';
import type { Topic } from '../types';
import { GENRE_LABELS, genreLabel } from '../utils/genre';

const STORAGE_KEY = 'ai-roundtable:votes';
const LIMIT = 50;

function loadVotedIds(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is number => typeof v === 'number'));
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveVotedIds(ids: Set<number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export function CandidatesPage() {
  const [candidates, setCandidates] = useState<Topic[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [genre, setGenre] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [votedIds, setVotedIds] = useState<Set<number>>(() => loadVotedIds());
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ id: number; type: 'ok' | 'err'; msg: string } | null>(null);

  const turnstileRef = useRef<TurnstileHandle>(null);

  const totalCount = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts],
  );

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .candidates({ genre, limit: LIMIT })
      .then((r) => {
        setCandidates(r.candidates);
        const map: Record<string, number> = {};
        for (const c of r.genre_counts) {
          const key = c.genre ?? '__other__';
          map[key] = c.count;
        }
        setCounts(map);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [genre]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleVote = async (topicId: number) => {
    if (votedIds.has(topicId) || pendingId !== null) return;
    setPendingId(topicId);
    setFeedback(null);

    try {
      const token = await turnstileRef.current?.getToken();
      if (!token) {
        setFeedback({ id: topicId, type: 'err', msg: '認証トークンを取得できませんでした' });
        return;
      }
      const res = await api.vote(topicId, token);
      if (res.ok) {
        const next = new Set(votedIds);
        next.add(topicId);
        setVotedIds(next);
        saveVotedIds(next);
        if (typeof res.votes === 'number') {
          setCandidates((prev) =>
            prev.map((c) => (c.id === topicId ? { ...c, votes: res.votes! } : c)),
          );
        }
        setFeedback({ id: topicId, type: 'ok', msg: '投票しました' });
      } else if (res.reason === 'already_voted') {
        const next = new Set(votedIds);
        next.add(topicId);
        setVotedIds(next);
        saveVotedIds(next);
        setFeedback({ id: topicId, type: 'err', msg: '既に投票済みです' });
      } else {
        setFeedback({
          id: topicId,
          type: 'err',
          msg: res.error ?? '投票に失敗しました',
        });
      }
    } finally {
      turnstileRef.current?.reset();
      setPendingId(null);
    }
  };

  return (
    <>
      <div className="archive-head">
        <h2>次の議題候補</h2>
        <p className="archive-sub">
          司会の Host が議論の終わりに提案した候補。投票で「読みたい度」が見える化されます。
          <br />
          <small>※ 投票結果は参考情報。次の議題は cron の進行順で自動的に選ばれます。</small>
        </p>
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
        {(counts['__other__'] ?? 0) > 0 && (
          <button
            className={`genre-tab ${genre === '__other__' ? 'active' : ''}`}
            onClick={() => setGenre('__other__')}
          >
            その他 <span className="genre-count">{counts['__other__']}</span>
          </button>
        )}
      </div>

      <div className="turnstile-row">
        <TurnstileWidget ref={turnstileRef} />
      </div>

      {error && <p className="error">エラー: {error}</p>}
      {loading && candidates.length === 0 && <p className="loading">読み込み中…</p>}
      {!loading && candidates.length === 0 && !error && (
        <p className="empty">このジャンルの候補は今ありません</p>
      )}

      <ul className="candidates-list">
        {candidates.map((c) => {
          const voted = votedIds.has(c.id);
          const isPending = pendingId === c.id;
          const fb = feedback?.id === c.id ? feedback : null;
          return (
            <li key={c.id} className={`candidate-item ${voted ? 'voted' : ''}`}>
              <div className="candidate-main">
                <span className="candidate-title">{c.title}</span>
                <span className="candidate-genre">{genreLabel(c.genre)}</span>
              </div>
              <div className="candidate-actions">
                <span className="candidate-votes" title="現在の投票数">
                  ▲ {c.votes}
                </span>
                <button
                  className="vote-btn"
                  onClick={() => handleVote(c.id)}
                  disabled={voted || isPending}
                >
                  {voted ? '投票済' : isPending ? '送信中…' : '投票する'}
                </button>
              </div>
              {fb && <p className={`vote-feedback vote-${fb.type}`}>{fb.msg}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
