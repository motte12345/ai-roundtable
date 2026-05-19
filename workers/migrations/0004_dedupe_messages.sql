-- 既存の重複メッセージをクリーンアップ（各 topic_id, turn_no の組み合わせで最古の1件のみ残す）
DELETE FROM messages
WHERE id NOT IN (
  SELECT MIN(id) FROM messages GROUP BY topic_id, turn_no
);
