# TODO.md — ai-roundtable

最終更新: 2026-06-26

## 要観察（オープンな確認項目）

### Bluesky（次の新議題＝turn1から始まる回で総合確認）
今セッションで投稿系を大幅に整備。次の「新議題1本まるごと」で以下を一度に見ると良い：
- [ ] 全11ターンが投稿され**歯抜けが無い**（リトライ＋「親＝直近投稿成功ターン」復帰が効いているか）
- [ ] 各投稿の先頭が `🟢 Optimist（楽観派）｜Gemini Flash-Lite:` のように**話者＋立場＋モデル名**表示
- [ ] **turn1** にリンク（青く facet）＋ハッシュタグ `#AI #AI議論 #<ジャンル>`（検索でヒットするか）
- [ ] 長い発言（Skeptic/Zen）が `(1/2)(2/2)`・`（続き）` で分割連投され繋がる
- [ ] プロフィールに `bot` セルフラベルが付いているか（規約ベストプラクティス）

### モデル運用
- [ ] **Workers AI の neuron 消費** — Zen=workers-ai は稼働確認済（topic432 turn7）。無料枠 10k neurons/日に Zen ~32 RPD が収まるか様子見。枯渇すると Groq 70B へ無害 fallback（ボトルネック解消効果は薄れる）。可視化や neuron budget guard は必要になったら追加
- [ ] **Gemini 無料枠の 503 再発監視** — 現状 Optimist/Host とも安定の `gemini-3.1-flash-lite`。`gemini-3.5-flash` は混雑が解消したら Optimist を分離して声の多様性を戻す余地あり（要再実測）

### 既存からの継続観察
- [ ] **議題多様性の改善効果** — 主題語チェック3層（2026-05-18）。`[skip-theme-overload]` ログで偏り却下が機能しているか
- [ ] **新ジャンル推定** — 新規 host_proposed のジャンルタグが妥当か

## ユーザー作業待ち
- [ ] Google Search Console プロパティ追加 + sitemap 送信
- [ ] AdSense 申請（トラフィック様子見後に判断）
- [ ] 高品質日本語 TTS の選択肢が出たら再検討（MeloTTS は実用不可。R2/AI binding は撤去せず保留）

## 検討中の打ち手（やるかは効果を見てから）
- [ ] **ハイライト既存410件の backfill** — 当面やらない方針（新規ぶんで様子見）。やるなら `backfill-highlights.ts` に `--limit N` を足して小バッチ・夜間で（ライブcron/無料枠の食い合い回避）
- [ ] **seo-title / host-memo の Gemini 3.x 化** — 現状 gemini-2.5-flash / 2.5-flash-lite。安定の 3.1-flash-lite に寄せる余地
- [ ] **議論キャラの声の多様化** — 現在 Optimist/Host=Gemini Flash-Lite（同一）、Skeptic/Zen=Llama 系。配線済みの Workers AI（Gemma4 / GLM / Qwen / Kimi 等）で1キャラ別モデルに振る余地。品質を実測してから

---

## 完了（2026-06-24〜26 セッション）

### Bluesky 本編配信（新規構築）
単一アカ・自己スレッド連投で議論を毎ターン流す（集客のX案とは別系統＝本編配信）。SPEC §8 参照。
- 設計（Backend Architect）→ `workers/lib/bluesky.ts`（createSession / buildPostChunks / postRecord / facet）→ messages に `bluesky_uri`/`bluesky_cid`列（migration 0010）→ turn-runner 統合（best-effort・`bluesky_enabled` メタで停止可）
- アカウント作成・app password・secret 投入・本番デプロイ・初回投稿確認まで完了
- **長文分割連投**（発言実測~500字を文境界で2投稿に分割、`(i/n)`/`（続き）`）
- **`Intl.Segmenter` が Workers 実機で約半分しか数えないバグ修正** → `Array.from`（コードポイント）に置換（trim/split が効いてなかった）
- **スレッド停止バグ修正** — 単発失敗が「親＝直前ターン固定」でカスケード停止 → **親＝直近の投稿成功ターン**（`getLatestPostedBskyRefBefore`）で自動復帰
- **投稿失敗時リトライ**（`createSessionWithRetry`/`postRecordWithRetry`、チャンク単位・線形バックオフ）
- **turn1 にハッシュタグ**（`#AI #AI議論 #<ジャンル>`、tag facet・byte実測検証済）
- **各投稿にモデル簡易名表示**（`shortModelLabel`、fallback時は実モデルが出る）
- 全て code-reviewer APPROVE / tsc / 実機検証済

### モデル更新・プロバイダ拡張
- **Gemini 3.x 化**（Host=`gemini-3.1-flash-lite`）。Optimist は 3.5-flash→503多発で `gemini-3.1-flash-lite` に統一（実測 flash-lite=5/5・2.5-flash=3/5・3.5-flash=0/5）
- **Cloudflare Workers AI をプロバイダ追加**（`env.AI.run()`、外部キー不要）。**Zen を `@cf/meta/llama-3.3-70b-instruct-fp8-fast` に移し Groq 70B の TPD ボトルネック解消**（稼働確認済）。`env.AI.run` の this ロスト＋OpenAI形式レスポンスの二重バグも踏破。Cerebras gpt-oss は削除
- 現行割当: Optimist/Host=Gemini 3.1 Flash-Lite、Skeptic=Llama 4 Scout(Groq)、Zen=Llama 3.3 70B(Workers AI)、fallback は Groq Llama 群

### バグ修正
- **ハイライトが 0/410 で全滅していたのを修正**（リリース以来一度も成功せず）— ① プロンプト未明示でモデルが `turn`(≠`turn_no`)を返し検証全滅 ② 全文投入で Groq 8B の TPM 6000 超過→413。スキーマ具体例＋200字truncate＋`turn_no??turn`＋temp0.3で修正。反映確認済
- **議題タイトルへの `[{tech}]` 混入修正** — Host テンプレの `[{ジャンル}]` プレースホルダが literal 出力。`[ジャンル]`＋パーサ防御＋既存109件をDB掃除

---

## 未実装の機能候補

### 高優先（実装済の延長で効くもの）
- [ ] **provider/出力の監視** — 今セッションで「best-effort が無言で劣化」が3件（ハイライト0/410・Optimist 503・Workers AI 全fallback）。provider列・出力件数・投稿状況を定期チェックする仕組み（`/api/current` への provider 表示や日次集計）があれば早期発見できる
- [ ] **議論の温度メーター** — 各発言の反論度/同意度を AI 判定
- [ ] **管理ダッシュボード** — 議題承認/却下、強制再生成、NGワード設定（Cloudflare Access 認証）
- [ ] **議題消化順の多様性化** — `getNextPendingTopic` を直近完了とジャンル/主題が被らない順に

### 中優先
- [ ] **動的OGP画像** — 議題タイトル入り画像をオンザフライ生成
- [ ] **逆議題自動生成** — 同じ議題を逆順で再生成して結論が変わるか
- [ ] **議題タイムカプセル** — 1年前の同日議題を表示

### 低優先（要慎重判断）
- [ ] **新キャラ追加 / 特別ゲスト回** — 検証コスト大
- [ ] **議題ごとのコメント欄** — 荒らし対策が重く無料運用と相性悪い

### 見送り
- ~~議題提案フォーム~~ — インジェクションリスク（投票機能で代替）
- ~~MeloTTS によるニューラル TTS~~ — 日本語フォニーム破綻で実用不可

---

## 完了済み（Phase 0–3）

### Phase 0–2: 基盤構築
仕様策定、PoC、Cloudflare Workers/D1/Pages、`roundtable.simtool.dev` 割当。

### Phase 3: 公開・運用機能
- **観客向け**: カウントダウン / TL;DR / 関連議題 / キャラ別ハイライト / 投稿日時 / Host メモ / 音声読み上げ（Web Speech + ボイス選択）
- **SEO・集客**: 動的OGPメタ / RSS / SNSシェア / SEOタイトル / sitemap / robots / JSON-LD / OGP画像 / GA4 / portal リンク
- **ユーザー参加**: ブックマーク / 議題候補投票（`/candidates`、Turnstile + IPハッシュ）
- **キャラ拡張**: プロフィールページ / 関係性可視化（`/relations`）
- **運用・自動化**: Cron失敗LINE通知 / 失敗ターン自動リトライ / 重複検知 / archive+ジャンルフィルタ / line-notify 連携
- **無料枠最適化**: ハイライトをMistralに / SkepticをLlama 4 Scoutに / ジャンル推定スコア式化
- **TTS インフラ（保留）**: Workers AI MeloTTS + R2 一式（`tts_daily_budget=0` で停止中）。日次予算ガード / `/api/tts-status`
