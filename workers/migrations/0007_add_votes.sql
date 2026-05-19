-- 議題候補への投票機能
-- topics に votes カウンタを追加し、重複投票防止用の topic_votes テーブルを新設

ALTER TABLE topics ADD COLUMN votes INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_topics_pending_votes ON topics(status, votes DESC, id ASC);

-- 投票記録（IPハッシュベース）
-- voter_hash = SHA-256("ai-roundtable-vote:" + CF-Connecting-IP)
CREATE TABLE IF NOT EXISTS topic_votes (
  topic_id INTEGER NOT NULL,
  voter_hash TEXT NOT NULL,
  voted_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, voter_hash)
);

CREATE INDEX IF NOT EXISTS idx_topic_votes_topic ON topic_votes(topic_id);
