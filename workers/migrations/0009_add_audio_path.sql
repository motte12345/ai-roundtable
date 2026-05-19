-- 各発言の生成済み音声 MP3 への R2 パス
-- 値が入っていれば <audio src="..."/> で再生、null なら Web Speech API でフォールバック
-- パス例: audio/topic-42/turn-3.mp3
ALTER TABLE messages ADD COLUMN audio_path TEXT;
