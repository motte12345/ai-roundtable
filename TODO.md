# TODO.md — ai-roundtable

最終更新: 2026-05-18

## 直近やるべきこと

### 要観察（実装後の動作確認）
- [ ] **議題多様性の改善効果** — Host コンテキスト注入 + 多様性ルール + 主題語チェック 3層を実装（2026-05-18）。5議題分くらい消化したら、新 host_proposed の主題分布が偏らないか確認。「creativity / happiness / emotion」あたりに新規候補が3件以上溜まったら却下されているか cron ログ（`[skip-theme-overload]`）で確認
- [ ] **Llama 4 Scout 移行後の Skeptic 出力品質** — 文字数遵守・口調・反論のキレを2-3議題分モニタリング（2026-05-09 切替）
- [ ] **新ジャンル推定ロジック** — 新規 host_proposed 議題のジャンルタグが妥当か確認（2026-05-10 修正）
- [ ] **TTS ボイス選択 UI** — ユーザー側で OS 別の良いボイスに切替して品質改善するか観察（2026-05-10 追加）

### ユーザー作業待ち
- [ ] Google Search Console プロパティ追加 + sitemap 送信
- [ ] AdSense 申請（トラフィック様子見後に判断）

## 進行中

### Bluesky 本編配信（着手 2026-06-24、SPEC §8 参照）
単一アカ・自己スレッド連投で、議論を毎ターン Bluesky に流す。集客のX案とは別系統（本編配信）。
**実装完了・レビュー済み（tsc通過）。残りはユーザー作業（アカウント/secret）＋実機検証のみ。**
- [x] **設計確定** — Backend Architect が詰めた（messages列追加方式・facets・冪等性・フック点）
- [x] **`workers/lib/bluesky.ts` 実装** — createSession / buildPostText / postRecord / buildLinkFacet。grapheme(Intl.Segmenter)で300制限トリム、facetでURL付与
- [x] **スレッド参照の永続化** — `0010_add_bluesky_refs.sql`（messages に bluesky_uri/bluesky_cid 列）+ db.ts に getMessageBskyRef/updateMessageBskyRef
- [x] **turn-runner.ts への統合** — incrementTopicTurn 直後に best-effort 投稿（getMeta含め try で囲い議論を止めない）
- [x] **`bluesky_enabled` メタフラグ** — 再デプロイなし停止（wrangler.toml にSQLコマンド記載）
- [x] **話者プレフィックス整形** — `▣ Host:` / `🟢 Optimist:` / `🔴 Skeptic:` / `🟣 Zen:`
- [x] **Env 型 + wrangler.toml コメント** — BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD
- [x] **レビュー** — code-reviewer（mutation等の指摘を反映済み）+ security-reviewer（secret漏洩なし・SQLバインド済み・SSRFなしを確認、対応不要）
- [x] **Bluesky アカウント準備** — アカウント作成済み（app password 発行・bot ラベルはユーザー確認）
- [x] **secrets 投入** — `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` を本番 Worker に設定済み
- [x] **マイグレーション適用** — 0010 を local + remote に直接 execute で適用（`migrations apply` はこのDBの追跡と不整合のため不使用。KNOWLEDGE 参照）。remote の messages に bluesky_uri/cid 確認済み
- [x] **本番デプロイ** — 2026-06-24 `npm run worker:deploy` 完了（Version ffca4473）。cron 稼働中
- [ ] **初回スレッドの目視検証（要観察）** — デプロイ時 active だった #427 は turn1 が旧投稿のため Bluesky には出ない（skip）。**最初の実スレッドは #427 完走後に始まる次議題の turn1 から**（デプロイ from 約2.5h後）。出たらスレッド連結・リンク(facet)・プレフィックス・文字数・bot表示を確認。問題あれば `bluesky_enabled='0'` で即停止
- [ ] **コミット** — 変更一式（bluesky.ts ほか）は未コミット。デプロイ済みなので早めにコミットする

## 未実装の機能候補

### 高優先（実装済の延長で効くもの）
- [ ] **議論の温度メーター** — 各発言の反論度/同意度を AI 判定、ハイライト同様トークン消費あり
- [ ] **管理ダッシュボード** — 議題承認/却下、強制再生成、NGワード設定（Cloudflare Access で認証）
- [ ] **議題消化順の多様性化（打ち手5、保留中）** — 現在の `getNextPendingTopic` は host_proposed を作成順（古い順）で消化。直近完了議題のジャンル/主題と被らないものを優先する SQL に切替えると、生成側の偏り対策（実装済）と合わせて視聴体験の偏りも解消できる。先に生成側の効果を見てから判断

### 中優先（インパクトあるが工数中以上）
- [ ] **動的OGP画像** — 議題タイトル入り画像をオンザフライ生成（現状は固定 `/ogp.png`）
- [ ] **逆議題自動生成** — 同じ議題を逆順で再生成して結論が変わるか実験
- [ ] **議題タイムカプセル** — 1年前の同日議題を表示（運営1年経過後）

### 低優先（要慎重判断）
- [ ] **新キャラ追加 / 特別ゲスト回** — 既存4キャラの相互作用が安定したので、追加するなら検証コスト大
- [ ] **議題ごとのコメント欄** — 荒らし対策含めて重い、無料運用と相性悪い

### 将来課題（外部状況待ち）
- [ ] **高品質日本語 TTS** — MeloTTS は日本語実用不可と判明（2026-05-10）。VOICEVOX 自前ホスト / Workers AI の新モデル / Google TTS 等の選択肢が出たら再検討。インフラ（R2 / AI binding）は撤去せず保留

### 見送り
- ~~議題提案フォーム~~ — インジェクションリスクのため見送り（投票機能で代替）
- ~~MeloTTS によるニューラル TTS~~ — 日本語フォニーム破綻で実用不可

## 完了済み

### Phase 0–2: 基盤構築
仕様策定、PoC、Cloudflare Workers/D1/Pages、`roundtable.simtool.dev` 割当まで完了。

### Phase 3: 公開・運用機能
- **観客向け体験**
  - 次ターンまでカウントダウン
  - 議論TL;DR（3行要約）
  - 関連議題リンク
  - キャラ別発言ハイライト（Mistral 優先 / Groq fallback）
  - 各発言に投稿日時表示
  - Host のメモ（議題完了時に Gemini Flash-Lite が生成）
  - 音声合成読み上げ（Web Speech API + ボイス選択UI）
- **SEO・集客**
  - 動的OGP メタタグ（タイトル・説明）
  - RSS フィード（`/rss.xml`）
  - SNS シェアボタン
  - 議題タイトル SEO 最適化（Gemini Flash）
  - sitemap.xml（動的）/ robots.txt / JSON-LD
  - OGP画像生成（共通方式 `scripts/generate-ogp.mjs`）
  - GA4 (`G-W6LWQMBRC9`)
  - simtool-portal にリンク追加
- **ユーザー参加**
  - 発言ブックマーク（localStorage）
  - 議題候補一覧 + 投票（`/candidates`、Cloudflare Turnstile + IPハッシュ多層防御）
- **キャラ拡張**
  - キャラプロフィールページ（`/character/:speaker`）
  - キャラ間の関係性可視化（`/relations`、言及マトリクス + インサイト）
- **運用・自動化**
  - Cron 失敗 LINE 通知（致命エラー / 3回連続失敗）
  - 失敗ターンの自動リトライ（messages 未挿入なら次 cron で同 turn_no 再試行）
  - 既出議題の重複検知（bigram Jaccard）
  - archive ページ + ジャンルフィルタ
  - line-notify の collect.py に追加
- **無料枠運用の最適化**
  - ハイライト生成を Mistral に逃がす（Groq TPD 緩和）
  - Skeptic を Llama 4 Scout に移動（Groq 3.3 70B TPD 半減）
  - ジャンル推定のスコア式化 + tech 偏重解消
- **TTS インフラ（保留中）**
  - Workers AI MeloTTS + R2 ストレージのコード一式（生成は `tts_daily_budget=0` で停止中、将来再開用）
  - 日次予算ガード（meta テーブル経由で無停止調整可）
  - `/api/tts-status` で残量確認可能
