/**
 * 発言ブックマーク（localStorage 永続化）。
 * key: { topic_id, turn_no } の組をキーに。
 */

const STORAGE_KEY = 'ai-roundtable:bookmarks:v1';

export interface BookmarkRef {
  topic_id: number;
  turn_no: number;
  saved_at: number;
}

function load(): BookmarkRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

function save(refs: BookmarkRef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refs));
  } catch {
    // quota exceeded など。失敗してもアプリは止めない
  }
}

export const bookmarks = {
  list(): BookmarkRef[] {
    return load().sort((a, b) => b.saved_at - a.saved_at);
  },
  has(topicId: number, turnNo: number): boolean {
    return load().some((b) => b.topic_id === topicId && b.turn_no === turnNo);
  },
  toggle(topicId: number, turnNo: number): boolean {
    const refs = load();
    const idx = refs.findIndex((b) => b.topic_id === topicId && b.turn_no === turnNo);
    if (idx >= 0) {
      refs.splice(idx, 1);
      save(refs);
      return false;
    }
    refs.push({ topic_id: topicId, turn_no: turnNo, saved_at: Date.now() });
    save(refs);
    return true;
  },
  count(): number {
    return load().length;
  },
};
