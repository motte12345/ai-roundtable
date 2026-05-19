-- 議題
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  genre TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | active | completed | rejected
  current_turn INTEGER NOT NULL DEFAULT 0,  -- 0..11 (0=未開始, 11=完了)
  source TEXT NOT NULL DEFAULT 'seed',      -- seed | host_proposed | manual
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_completed ON topics(completed_at DESC);

-- 発言
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  turn_no INTEGER NOT NULL,         -- 1..11
  speaker TEXT NOT NULL,            -- host | optimist | skeptic | zen
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id, turn_no);

-- メタ情報（key-value）
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
