-- 議題完了時に Host が書く「ひとこと」サブコメント。
-- 議論本編とは別の舞台裏的メタコメント、観客体験向上のための演出。
ALTER TABLE topics ADD COLUMN host_memo TEXT;
