-- 同一議題の同一ターンが二重投入されないようにする（レース対策）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_messages_topic_turn ON messages(topic_id, turn_no);
