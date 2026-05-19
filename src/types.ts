export type Speaker = 'optimist' | 'skeptic' | 'zen' | 'host';

export interface Topic {
  id: number;
  title: string;
  genre: string | null;
  status: 'pending' | 'active' | 'completed' | 'rejected';
  current_turn: number;
  source: string;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  seo_title: string | null;
  highlights: string | null;
  votes: number;
  host_memo: string | null;
}

export interface HighlightItem {
  turn_no: number;
  reason: string;
}

export interface Highlights {
  sharpest: HighlightItem;
  constructive: HighlightItem;
  illuminating: HighlightItem;
}

export interface Message {
  id: number;
  topic_id: number;
  turn_no: number;
  speaker: Speaker;
  provider: string;
  model: string;
  content: string;
  created_at: number;
  audio_path: string | null;
}

export interface SpeakerMeta {
  label: string;
  role: string;
  color: string;
  icon: string;
}

export const SPEAKER_META: Record<Speaker, SpeakerMeta> = {
  optimist: { label: 'Optimist', role: '楽観派', color: 'var(--optimist)', icon: '☀' },
  skeptic: { label: 'Skeptic', role: '懐疑派', color: 'var(--skeptic)', icon: '?' },
  zen: { label: 'Zen', role: '俯瞰派', color: 'var(--zen)', icon: '◎' },
  host: { label: 'Host', role: '司会', color: 'var(--host)', icon: '▣' },
};
