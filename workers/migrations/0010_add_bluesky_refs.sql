-- Bluesky 本編配信用: 各発言を投稿した AT Protocol ポストの参照を保存する。
-- uri: at://did:plc:.../app.bsky.feed.post/...  (reply の root/parent 連結に使う)
-- cid: 当該ポストの CIDv1 ハッシュ
-- どちらも NULL なら未投稿（best-effort で失敗したケースを含む）。
-- bluesky_uri IS NOT NULL を「投稿済み」判定に使うことで、cron 二重発火・リトライ時の
-- 二重投稿を防ぐ（冪等性ガード）。
ALTER TABLE messages ADD COLUMN bluesky_uri TEXT;
ALTER TABLE messages ADD COLUMN bluesky_cid TEXT;
