import type { Message, Topic } from './types';

// Vite dev server から /api/* を Worker に proxy する設定は vite.config.ts 側
// 本番では同じ Worker が静的アセットも /api/* も処理するので相対パスで OK

interface CurrentResp {
  topic: Topic | null;
  messages: Message[];
}

interface RecentResp {
  topics: Topic[];
}

interface TopicResp {
  topic: Topic;
  messages: Message[];
}

interface ArchiveResp {
  topics: Topic[];
  next_cursor: number | null;
}

interface GenreCount {
  genre: string | null;
  count: number;
}

interface GenresResp {
  counts: GenreCount[];
}

interface CharacterStats {
  total_messages: number;
  total_topics: number;
  avg_length: number;
}

interface CharacterMessage extends Message {
  topic_title: string;
}

interface CharacterResp {
  speaker: string;
  stats: CharacterStats;
  recent_messages: CharacterMessage[];
  frequent_words: Array<{ word: string; count: number }>;
}

interface CandidatesResp {
  candidates: Topic[];
  genre_counts: GenreCount[];
}

interface RelationsResp {
  speakers: string[];
  matrix: Record<string, {
    total: number;
    mentions: Record<string, number>;
  }>;
}

interface VoteResp {
  ok: boolean;
  reason?: string;
  topic_id?: number;
  votes?: number;
  error?: string;
  detail?: string[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

export const api = {
  current: () => fetchJson<CurrentResp>('/api/current'),
  recent: (limit = 10) => fetchJson<RecentResp>(`/api/recent?limit=${limit}`),
  topic: (id: number) => fetchJson<TopicResp>(`/api/topic/${id}`),
  archive: (opts: { cursor?: number; limit?: number; genre?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor !== undefined) params.set('cursor', String(opts.cursor));
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.genre) params.set('genre', opts.genre);
    const qs = params.toString();
    return fetchJson<ArchiveResp>(`/api/archive${qs ? '?' + qs : ''}`);
  },
  genres: () => fetchJson<GenresResp>('/api/genres'),
  character: (speaker: string) => fetchJson<CharacterResp>(`/api/character/${speaker}`),
  relations: () => fetchJson<RelationsResp>('/api/relations'),
  candidates: (opts: { genre?: string | null; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.genre) params.set('genre', opts.genre);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return fetchJson<CandidatesResp>(`/api/candidates${qs ? '?' + qs : ''}`);
  },
  vote: async (topicId: number, turnstileToken: string): Promise<VoteResp> => {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId, turnstile_token: turnstileToken }),
    });
    return (await res.json()) as VoteResp;
  },
};
