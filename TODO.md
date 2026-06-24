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

### Bluesky 投稿の堅牢化（2026-06-25）
- [x] **スレッド停止バグ修正** — topic432 turn4 の単発失敗が parent=直前ターン固定のせいでカスケード停止していた。parent を「直近で投稿成功したターン」(`getLatestPostedBskyRefBefore`)に変更し単発失敗から自動復帰。診断は一時 `/api/_bskyprobe` で createSession/postRecord が正常なことを確認（撤去済）。デプロイ 065d5dbf
- [ ] **復帰確認（要観察）** — topic432 の turn10 以降、または次議題で `bluesky_uri` が再び付くか確認


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
- [x] **初回投稿確認** — 2026-06-24、topic #428/#429 でスレッド投稿を確認。リンク(facet)・プレフィックス・bot 表示OK
- [x] **長文切れ対策（分割連投）** — 発言が実測~500字で長すぎた → 文境界で分割しサブ投稿として連投（`buildPostChunks`/`splitContent`）
- [x] **分割が効かないバグ修正** — `Intl.Segmenter` が Workers 実機でグラフェムを約半分しか数えず、trim/split が無効化されていた（本番feed調査で発覚：05:30〜09:00 の投稿が全部500字級フル長）。`Array.from`（コードポイント数）に置換。code-reviewer APPROVE、node実機で384字→2投稿(295/116)確認、デプロイ済み(Version b508f9e3)。※Bluesky の300は API ハード上限ではなく公式アプリの表示クリップ閾値と判明（KNOWLEDGE 参照）
- [ ] **修正後の目視検証（要観察）** — b508f9e3 反映後に投稿される Skeptic/Zen ターンが ≤300字×2投稿に正しく分かれ、`(1/2)(2/2)`・`（続き）`が付き繋がるか確認（現 thread #429 は途中からこの挙動に切替わる混在）
- [ ] **`bot` セルフラベル** — アカウントのプロフィールに付いているか確認（規約ベストプラクティス）

### Workers AI 導入（2026-06-25）
- [x] **Cloudflare Workers AI をプロバイダ追加** — `createWorkersAiProvider`（`env.AI.run()`、外部キー不要）。Zen primary を `@cf/meta/llama-3.3-70b-instruct-fp8-fast` に、Groq 70B を fallback に。Groq 70B の TPD ボトルネック解消狙い。code-reviewer APPROVE、デプロイ Version a2976185、コミット f3233de
- [x] **Workers AI 失敗の原因特定・修正** — 当初 provider=groq に fallback していた。原因は二重バグ：① `env.AI.run` を detach 呼び出しで `this` ロスト（`#options` エラー）② 新モデルは OpenAI 形式 `choices[0].message.content` を返す（`{response}` でなく）。両方修正＋一時プローブで疎通確認（"こんにちは。"）。デプロイ 09653489。詳細 KNOWLEDGE
- [ ] **【要確認】Zen が workers-ai になるか** — 修正後の次の Zen ターンで `SELECT turn_no,provider,model FROM messages WHERE speaker='zen' ORDER BY id DESC LIMIT 3`。`workers-ai` なら成功＝Groq 70B ボトルネック解消。neuron 消費も様子見
- [x] **Optimist のモデル 503 問題を修正** — 3.5-flash(0/5)→一度 2.5-flash に戻すも実測3/5でまた落ちた→**実測で唯一5/5の `gemini-3.1-flash-lite` に統一**（Host と同じ。合計~49 RPDで枠余裕）。`geminiFlash` 関数は削除。デプロイ 55bb84e8
- [x] **タイトル `[{tech}]` 混入バグ修正** — Host テンプレの `[{ジャンル}]` プレースホルダが literal 出力されていた。`[ジャンル]` に修正＋パーサ防御＋既存109件のタイトルをDB掃除済み
- [ ] **【要確認】neuron 消費** — Workers AI 無料枠 10k neurons/日。Zen ~32 RPD で収まるか。枯渇すると Groq に fallback（無害だが解消効果が薄れる）。`/api/tts-status` 的な可視化や neuron budget guard 追加は効果を見てから判断
- [ ] **【軽微バグ】議題タイトルにジャンルタグ混入** — 議題432 のタイトルが「AIとの「対話」で自己理解を深めるか **[{tech}]**」。Host closing の次議題パースで `[genre]` 表記がタイトルに残るケースがある（`extractNextTopicProposals` の正規表現 or genre 抽出漏れ）。要調査・別件

### モデル更新・要観察（2026-06-24）
- [x] **Gemini 3.x へ更新** — Optimist=`gemini-3.5-flash` / Host=`gemini-3.1-flash-lite`（実API検証済、デプロイ Version 109b4513）
- [ ] **3.x 移行後の品質観察** — 2-3議題ぶん、Optimist/Host の口調・字数遵守・thinking途切れ無しを確認。429（無料枠超過）が出ないかも監視
- [x] **ハイライト全滅バグ修正** — 調査の結果 **0/410 件**（リリース以来一度も成功せず）。原因二重：① プロンプトがスキーマ未明示でモデルが `turn`（≠`turn_no`）を返し検証全滅 ② 全文投入で Groq 8B の TPM 6000 超過→413。修正＝プロンプトにJSON具体例＋各ターン200字truncate＋`turn_no??turn`両受け＋temp0.3。実API(Groq8B)で総合PASS確認、code-reviewer APPROVE、デプロイ Version 0b2d8711。詳細 KNOWLEDGE
- [ ] **ハイライト反映確認（要観察）** — 0b2d8711 後に完了する議題で `highlights` が埋まるか確認（次の議題完了時）
- [ ] **（保留・任意）既存410件の backfill** — 2026-06-24 ユーザー判断で**当面やらない**（新規ぶんだけで様子見）。やるとしても「超スロー・ちょっとずつ」方針。現 `backfill-highlights.ts` は全件一括処理なので、その時は **`--limit N` フラグを足して小バッチ（例 10件/回）で回す**改修が必要。ライブcronと無料枠の食い合いを避けるため夜間/低頻度で
- [ ] **（任意）seo-title/host-memo も Gemini 3.x 化** — 現状 gemini-2.5-flash / 2.5-flash-lite のまま。上げるなら別途

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
