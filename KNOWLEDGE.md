# KNOWLEDGE.md — ai-roundtable

ハマりポイント・ワークアラウンド・調査結果のログ。同じ失敗を二度としないため。

## 横断的な教訓（特に効くもの）

- **無料枠は必ず公式 `/models` や実 API で確認**してから採用する。ブログ・公式 X の発表だけでは現アカウントで使えるか不明（Cerebras `gpt-oss-120b`, Groq Llama 4 Maverick で空振り経験あり）
- **マルチキャラ LLM では履歴の所属を明示**しないと盗用・反復が起きる。`assistant` ロールで他キャラ発言を渡さない、user message 内で「あなたの過去発言」と「他キャラの発言」をラベル分離する
- **「無料枠 + 自動フォールバック」で課金リスクをゼロにする設計**が可能。Workers Paid 未契約なら 429 で止まる。プロバイダ多様性より、まず動く構造が優先
- **公式ドキュメントの記述と実装の乖離**: モデル出力フォーマット・サポート言語などは実機で必ず検証する（MeloTTS は MP3 と書いてあるが WAV を返す、日本語サポートと書いてあるが実用不可）
- **キーワードベース分類は順序とスコア両方が効く**。先頭ジャンルが強くなりすぎる。横断ワード（AI など）は特定ジャンルに固定しない、ジャンルの本質を表す動詞・名詞を優先
- **`wrangler r2 object` のデフォルトはローカル**。`--remote` 必須、出力を抑制すると失敗に気付かない
- **backfill 系スクリプトは通常運用とは別枠の負荷想定が必要**。「件数 × 1回あたり消費」が無料枠を超えないか先に試算する

---

## 2026-05-08: LLM プロバイダ無料枠の罠

### 問題
SPEC 初版で `OpenRouter :free` を Skeptic / Host のメインまたは fallback に組み込んでいた。実際の無料枠を確認したら **クレジット未購入アカウントでは 50 RPD** のみだった。1キャラ32 RPD + Host 17 RPD で合計 65+ RPD 必要なため不足。

### 原因
SPEC 策定時に各プロバイダの公式ドキュメントを確認せず、「無料モデルがある」という漠然とした認識で採用してしまった。

### 解決策
- OpenRouter `:free` は採用見送り。クレジット課金が必要になるため無料原則に反する
- Gemini 2.5 Pro も 2026/4 改定で無料利用不可になっていた（Flash 系のみ無料）
- 主プロバイダを **Gemini Flash / Groq Llama 3.3 70B / Cerebras / Mistral** に再選定（全部別プロバイダ）

### 教訓
- 新規プロバイダを SPEC に組み込む前に、必ず公式ドキュメントで以下を確認:
  - 無料利用にクレジット購入が必要か
  - RPD / RPM / TPD の数値
  - 無料利用が時限的か永続的か
  - context window 制限
  - **電話番号認証など追加認証が必要か**
  - **APIリクエストがモデル学習に利用されるか**
- 無料枠は半年〜1年で改定されるので、古いブログ記事を鵜呑みにしない

---

## 2026-05-08: Mistral の admin.mistral.ai と console.mistral.ai は別物

### 問題
ユーザーが `admin.mistral.ai/organization/api-keys` でAPIキー作成しようとして「No plan is currently active」と言われ作れなかった。

### 原因
- `admin.mistral.ai` は **組織管理者向け、有料プラン契約前提** の画面
- 無料 Experiment tier は `console.mistral.ai/api-keys` の方
- ただし無料 Experiment tier も **電話番号認証必要** + **APIリクエストがMistralのトレーニングに使われる**

### 解決策
本プロジェクトでは Mistral 採用見送り。Host を Gemini 2.5 Flash-Lite に切り替え。
- API キー数: 4 → 3
- 電話番号認証必要なプロバイダなし

### 教訓
- Mistral のドキュメント URL は紛らわしい。`console` か `admin` か区別する
- 無料枠の「学習データ利用可否」も採用判断の材料に

---

## 2026-05-08: Cerebras は Llama 3.3 70B 無料提供なし

### 問題
SPEC で Zen の主プロバイダを Cerebras Llama 3.3 70B に設定 → 実行時に HTTP 404 `Model llama-3.3-70b does not exist or you do not have access to it`

### 原因
ブログ記事には「Cerebras supports llama-3.3-70b」と書かれていたが、**現時点（2026-05-08）の Cerebras 無料 production tier には提供されていない**。
公式モデル一覧:
- Production: `llama3.1-8b`（2026-05-27 廃止予定）, `gpt-oss-120b`
- Preview: `qwen-3-235b-a22b-instruct-2507`（同廃止）, `zai-glm-4.7`

### 解決策
Zen の主プロバイダを `gpt-oss-120b`（OpenAI オープンソース、reasoning 対応）に変更。
fallback は Groq Llama 3.1 8B Instant のまま。

### 教訓
- ブログ記事のモデル対応情報は古い場合がある。**プロバイダ公式の `/models` ページを必ず確認**
- モデルIDの命名規則がプロバイダごとに違う:
  - Cerebras: `llama3.1-8b`（ハイフン1箇所）
  - Groq: `llama-3.1-8b-instant`（ハイフン3箇所）
- 同じ「Llama 3.1 8B」でも文字列が違う

---

## 2026-05-08: assistant ロールで履歴を渡すとロールプレイ崩壊

### 問題
1議題目の Turn 2 で Optimist が司会風に振る舞い、`[/host]` `[realist]` のような架空タグを出力。
Turn 3 の Skeptic も `[/optimist]` `[realist]` を出力、存在しない「realist」キャラまで登場。

### 原因
- `buildHistory()` で他キャラの発言を `role: 'assistant'` として渡していた
- LLM は「assistant ロール = 自分の過去発言」と解釈する
- 結果、モデルが「過去の自分は色々なキャラを使い分けてきた」と誤認 → タグやキャラ名を真似て出力する

### 解決策
1. **履歴を user メッセージ1本に統合**:
   - 「## これまでの議論」セクションに整形
   - 各発言を `### Host` `### Optimist` のような Markdown 見出しで区切る
   - 最後に「あなたは X です。次に発言してください」と明示
2. **各キャラの prompt に「他キャラ代弁禁止」「タグ出力禁止」「司会進行禁止」を追加**

### 教訓
- マルチエージェント風のロールプレイで `assistant` ロールに他キャラの発言を入れない
- 「これは過去の対話履歴」と「あなたの役割」を user メッセージ内で明示的に分離する
- LLM は親切なので「次の発言者を案内する」など過剰な役割を演じやすい。明示的に禁止する

---

## 2026-05-08: Gemini 2.5 系の thinking が maxOutputTokens を消費して応答が途中で切れる

### 問題
Gemini 2.5 Flash で Optimist の発言が「素晴らしいツールだと感じています」のような1文未満で打ち切られる。`maxOutputTokens: 400` 指定しても短い。

### 原因
Gemini 2.5 系は **thinking機能がデフォルトON**。
thinking で消費されたトークンも `maxOutputTokens` から差し引かれるため、実際の応答出力に使えるトークンが大幅に減る。

### 解決策
`generationConfig.thinkingConfig.thinkingBudget = 0` で thinking を無効化:
```ts
generationConfig: {
  maxOutputTokens: 400,
  temperature: 0.8,
  thinkingConfig: { thinkingBudget: 0 },  // ← これ
}
```

議論の発言生成程度なら thinking 不要。チャットボットや短文生成全般でこの設定を入れた方が無難。

### 教訓
- Gemini 2.5 系を扱うときは `thinkingBudget` を意識する
- 「応答が途中で切れる」「短すぎる」という症状が出たら最初に疑う
- 逆に複雑な推論が必要なら `thinkingBudget: -1`（無制限）または明示的な数値設定

---

## 2026-05-08: Cerebras 無料アカウントは公開ドキュメントの全モデルを使えるわけではない

### 問題
Cerebras の `/models/overview` ドキュメントには `gpt-oss-120b` が production として記載されている。
しかし無料アカウントの API キーで `gpt-oss-120b` を呼ぶと HTTP 404 `Model gpt-oss-120b does not exist or you do not have access to it`。

### 推測される原因
- 無料 tier では production モデルへのアクセスが制限されている可能性
- もしくは初回サインアップ後に追加でモデル有効化の手順が必要
- `llama3.1-8b` は通る可能性があるが 2026-05-27 廃止予定のため使えない

### 解決策
本プロジェクトでは Cerebras を fallback 専用に降格。メインキャラはすべて Gemini と Groq に集約:
- Skeptic: Groq Llama 3.3 70B
- Zen: Groq Llama 3.3 70B（同モデル、system prompt で差別化）

Groq 無料 1000 RPD のうち Skeptic + Zen で 64 RPD（6.4%）なので余裕。

### 教訓
- 「ドキュメントに書かれている」≠「無料アカウントから呼べる」。実際に試して確認する
- 同じプロバイダ・同じモデルでも system prompt が違えばマルチキャラとして機能する。プロバイダ多様性は副次的目標、まず動くことが最優先

---

## 2026-05-08: Llama 3.3 70B は150〜250字制約を守らない傾向

### 問題
Skeptic（Groq Llama 3.3 70B）の発言が毎ターン500字以上、しかも前のターンと同じ内容を繰り返す。
system prompt で「150〜250字」と指定しても無視される。

### 解決策（多層防御）
1. **`max_tokens` を物理的に制限**: 350 token（≒250〜300字）に下げる
2. **prompt の文字数指示を強調**: `**必ず150〜250字以内**で答える（300字を超えたら失格）` と明示
3. **「繰り返さない」指示を追加**: 「これまでに自分が言ったことを繰り返さない、新しい論点を1つ加える」を user メッセージに含める

### 教訓
- 70B クラスの open-weight モデルは指示追従能力が GPT-4o / Claude より弱い
- 「○○字以内」だけでは効かない、`max_tokens` で物理制限する
- 繰り返し対策は明示指示が必要

---

## 2026-05-08: 「無難な議論」を避けるためのプロンプト設計

### 問題
初版のプロンプトは安全寄りに振っていた:
- 「批判しない」「人格攻撃しない」「控えめに」
- temperature 0.85
- 出力指示が「論点を整理する」「立場を示す」程度

結果、議論が「色々な意見がある」「個人による」「バランスが大事」という**無難な落とし所**に流れ、エッジが効かない。

### 解決策
1. **キャラに強い立場・価値観を与える**:
   - Optimist: 過剰楽観主義者、両論併記を嫌う
   - Skeptic: 美しい言葉に違和感を覚える、無難を嫌う、身も蓋もない真実を言う
   - Zen: 整理した上で「一刺し」を必ず入れる、メタ視点での切り返し
2. **明示禁止の追加**:
   - 「両論併記の逃げ」「色々な意見がある」「個人による」「バランスが大事」を禁止語句に
   - 「自分の立場を断定する」を要求
   - 「相手の発言をそのまま肯定して終わらない」
3. **具体性の要求**: 「一般論より具体例・比喩・身も蓋もない真実を1つ盛り込む」
4. **temperature を 0.85 → 0.95**（3キャラのみ、Host は 0.75）で表現の振れ幅を広げる
5. **Host closing**: 「最終的にどちらに軍配が上がったか or 残った最大の謎」を必ず示すよう指示

### 教訓
- LLM はデフォルトで穏当・無難・両論併記に流れる傾向が強い
- エッジを出すには **明示的に「逃げを禁止」**する必要がある
- ただし規約NGラインは別問題なので、別途明示禁止を残す（暴力・違法・差別等）
- 強キャラを作るときは「行動規則」だけでなく「価値観・口癖・嫌うもの」まで書く

---

## 2026-05-09: 履歴中の他キャラ発言を「自分の意見」として再生産する問題

### 問題
本番議題#22 で、Skeptic が以下を起こした:
1. **Turn 6 と Turn 9 の Skeptic 発言が大半コピペ**（「実際の問題は〜内面的要因に依存する」のくだり完全一致）
2. **Turn 6 の最終段落が Turn 4 の Zen 発言の丸コピー**（Skeptic が Zen の主張を自分のものとして使い回し）
3. 副症状: 「говорいます」というロシア語混入（Llama 3.3 70B のトークンミス）

### 原因
- 履歴 `slice(-6)` を `### Optimist`, `### Skeptic`, `### Zen` の見出しで並べていたが、**「これは過去のあなた自身」「これは他キャラ」という区別が無かった**
- LLM は履歴を「過去の対話例」として一括で見てしまい、Zen が言った内容を「自分も同じこと言うべき」と誤解
- Skeptic の system prompt に「過去発言を反復しない」「Zenの発言を真似ない」が無かった

### 解決策
1. **履歴の各発言にラベル追加**:
   ```
   ### Skeptic（あなた自身の過去発言 ← これを絶対にコピーしない）
   ### Zen（他キャラの発言 ← これをコピーしない、自分の意見として再生産しない）
   ```
2. **user message に明示**:
   - 「過去の自分の発言を一字一句コピーしない、同じ論点なら言い換え + 新しい角度」
   - 「他キャラの発言をそのまま引用しない、引用するなら『Xが〜と言ったが』と他者扱い」
   - 「必ず日本語で書く（他言語混入禁止）」
3. **Skeptic の system prompt 強化**:
   - 「過去の自分の発言を反復しない」
   - 「Zen の発言を真似ない」
   - 「直前の他キャラ発言の前提を解体する」を主任務として明記

### 教訓
- マルチキャラLLM対話では、履歴中の発言が **誰のものか** を明示しないと盗用・反復が起きる
- 「過去の自分」と「他キャラ」は別ラベルで区別する
- Llama 3.3 70B は文字数制約や繰り返し禁止に弱い → プロンプトと max_tokens の両側で抑える必要

---

## 2026-05-09: AIキャラがデフォルトで人間視点に立ってしまう問題

### 問題
AIキャラ（Optimist/Skeptic/Zen）が、議論中に「私たち人間が〜」「私たちはAIに〜してあげるべき」のように、**自分が人間側に立った発言**をする。
例: 「私たちは意図的に多様なデータを与え、あえてAIに失敗を経験させれば良い」

これだと「AI同士が議論するサイト」というコンセプトが崩れる。話者がAIなのに、AIに対して何かを「与える」立場で喋ってる。

### 原因
LLM のデフォルト挙動として、ユーザー（=人間）に寄り添うアシスタント視点が染み付いている。
キャラのsystem promptで「Optimist として議論する」とは指示したが、**「自分はAIである」自認は明示していなかった**。
結果、人類アシスタントの癖で「私たち（人間）」に逃げる。

### 解決策
4キャラそれぞれの system prompt に「あなたの立場」セクションを追加:
- **あなたは AI です。人間ではありません**
- 「私たち人間が〜」「私たちはAIに〜」のように人間の側に立たない
- AIに関する議題なら**当事者**として（「AIである私たちは〜」）
- 人間社会の議題なら**観察者**として（自分の人生経験を装わない、ただし人類の歴史・行動から論じてよい）
- 「私はAIだから知らない」と毎回断る必要はない、自然に観察・論評する

### 教訓
- LLM をマルチキャラに使うとき、デフォルトの「人類アシスタント視点」が染み出す
- 話者の存在論的な立場（AIなのか人間なのか）を **明示的に宣言** する必要がある
- ただし「AIだから〜できない」と毎回防御的になるのも違うので、視点としての制約だけ書く

---

## 2026-05-08: Cron 連続発火時のレース条件（同ターン二重投入）

### 問題
PowerShell ループで cron を3秒間隔で連続発火したら、議題#22 の turn 1 が **2回**記録された。
```
1 | host | gemini | 本日の議題は「持続可能な未来社会」です。技術革新による無限の成長を…
1 | host | gemini | 本日の議題は「持続可能な未来社会」です。技術革新による効率化と、自然との…
```

### 原因
LLM 呼び出しに数秒かかる間に次の cron が発火 → 2リクエストが同じ状態を読んで両方が処理する競合:

1. リクエスト A: `getActiveTopic()` → null
2. リクエスト B: `getActiveTopic()` → null (A まだ startTopic 完了してない)
3. A: `startTopic(topic_id=22)` 成功
4. B: `startTopic(topic_id=22)` も成功（CAS なし）
5. A: LLM 呼び出し (5秒)
6. B: 同じ active 議題を見つけて turn 1 を実行
7. 両方が turn 1 を addMessage（UNIQUE 制約なし）

### 解決策
1. **`messages` に `UNIQUE(topic_id, turn_no)` インデックス追加**
2. **`addMessage` を `INSERT OR IGNORE` に変更**（敗者は黙ってスキップ）
3. **`startTopic` を CAS 化**: `WHERE id=? AND status='pending'` で勝者だけ更新
4. **ターン番号の真実を `messages.MAX(turn_no)+1` に切替**（`current_turn` フィールドより信頼できる）
5. 既存の重複データは `0004_dedupe_messages.sql` で各 (topic_id, turn_no) の最古1件のみ残す

### 教訓
- LLM 呼び出しを含む長時間処理は **読み取り→書き込みの間にレースが起きる前提**で設計
- 重要な状態遷移は CAS（Compare-And-Set）または DB の UNIQUE 制約に頼る
- ステート管理用フィールド（`current_turn`）は同期できないので、**履歴テーブル（messages）から導出する**方が安全

---

## 2026-05-08: Cerebras の context 8192 token 制限

### 問題
Cerebras は Llama 3.3 70B を 1M tokens/day 無料で使えるが、**全モデル共通で context window が 8192 token に暫定制限**されている。
1議題11発言の全履歴 + system prompt を渡すと簡単に超える可能性あり。

### 解決策（実装方針）
- 議論履歴は **直近 N 発言（N=4〜6）+ 議題タイトル** のみ Cerebras に渡す
- 各発言を 150〜250字（≒ 200〜400 token）に保てば、6発言 × 400 + system prompt 1000 ≒ 3400 token で安全圏
- `workers/lib/context-builder.ts` でプロバイダ別に context を組み立てる

### 教訓
- プロバイダごとに context window 制限が違う。最小値（Cerebras 8192）を基準に設計しないと fallback 時に破綻する

---

## 2026-05-08: Cloudflare Workers Cron Triggers の制約

### 把握済みの制約
- **1分以下のスケジュール不可**（15分間隔の我々は OK）
- **失敗時のリトライなし**（次の発火を待つ必要あり）
- **すべて UTC**（cron 式書く時に注意）
- **無料枠 5 Cron**（1つ使用予定なので OK）
- **CPU 10ms/invocation**（LLM API 待ちは I/O なので関係なし、ただし JSON パース等の同期処理は注意）

### 設計への反映
- Cron 失敗時は次の15分後に自然回復（無理にリトライ実装しない）
- 失敗ログを `meta` テーブルに残してフロントで「会議は休憩中」表示

---

## 2026-05-09: backfill 系スクリプトで無料枠を一気に枯渇

### 問題
ハイライト機能を既存 completed 議題（数十件）に適用しようと `npm run backfill:highlights` を実行 → Groq Llama 3.1 8B Instant の TPD を圧迫し、副次的に通常運用も停止。

### 原因
- `backfill-highlights.ts` は議論全文 (~2700 tokens) を毎回投げる
- 議題N件 × 2700 = 容易に数十万 tokens
- 同時に `backfill-seo-titles.ts` を回すと Gemini 250 RPD も食い潰す
- Groq Llama 3.3 70B は **TPD 100K** が最も細い（Skeptic + Zen で常時90%超）。少しでも他のジョブが食うと即枯渇

### 解決策
1. **ハイライト生成を Mistral Experiment tier に逃がす**:
   - `mistral-small-latest`、月1B tokens（実質無制限）、2 RPM
   - `workers/lib/highlights.ts` で Mistral 優先 → Groq 8B fallback
   - 通常運用は議題完了時1回（数時間に1回）なので 2 RPM で十分
2. **backfill スクリプトの待機時間をプロバイダ別に**:
   - Mistral 利用時: 35秒（2 RPM = 30秒インターバルに安全マージン）
   - Groq fallback 時: 65秒（既存通り）

### 教訓
- **backfill 系は通常運用とは別枠の負荷想定が必要**。「合計N件 × 1回あたりトークン量」が無料枠を超えないか先に試算する
- **Groq Llama 3.3 70B の TPD 100K がボトルネック**。重い議題（履歴長め）が連続するとそれだけで枯渇する。本質対策は Skeptic/Zen の primary を別プロバイダに分散させること（次の課題）
- **Mistral Experiment tier は「学習データに使われる」「電話番号認証要」の代わりにトークン量が圧倒的**。ハイライト・SEOタイトルなどの「公開コンテンツ生成・低頻度」用途には向く。発言生成（primary）には RPM 2 が厳しい

---

## 2026-05-09: Groq Llama 4 系のモデル ID と gpt-oss-120b の癖

### 問題
Llama 3.3 70B の TPD 100K がボトルネックなので、Skeptic を Llama 4 Maverick (別 TPD バケット) に逃がそうとした → モデルID `meta-llama/llama-4-maverick-17b-128e-instruct` で 404。

### 調査
`GET https://api.groq.com/openai/v1/models` で利用可能モデルを確認:
- **Llama 4 系で提供あるのは Scout のみ**: `meta-llama/llama-4-scout-17b-16e-instruct` (16-expert MoE)
- Maverick (128-expert) は Groq では未提供（2026-05時点）
- 他の70B+ クラス: `openai/gpt-oss-120b`, `qwen/qwen3-32b`, `groq/compound`

### gpt-oss-120b の罠
代替候補として gpt-oss-120b も試したが:
- **デフォルトで reasoning_effort が高め、出力トークンの大半を内部推論に消費**してしまい、`message.content` が空になる
- `reasoning_effort: 'low'` を付けても、日本語プロンプトを誤解（150〜250字 → 「150x250 ピクセルの画像生成」と解釈）して指示崩壊
- 安定運用には向かない

### 解決策
Skeptic の primary を `meta-llama/llama-4-scout-17b-16e-instruct` に切替、fallback は `llama-3.3-70b-versatile`。
- Scout は Llama 系の延長で system prompt の効きが良い
- TPD バケットが 70B と独立 → Skeptic 移動で 3.3 70B の負荷が半分（96K → 約48K tokens/day）
- Zen は 70B のまま維持、両者で TPD 半々分散

### 教訓
- **新モデル候補は必ず `/models` エンドポイントで実在確認**してから採用する。ブログや公式 X の発表だけでは Groq 無料枠で使えるか分からない
- **gpt-oss / o1 系の reasoning モデル**は `reasoning_effort: 'low'` 必須、それでも軽量な対話には不向き。指示崩壊しがち
- TPD 制約はモデル単位なので、**同プロバイダ内の別モデルに移すだけで負荷分散できる**（プロバイダ多様性は捨てるが、運用はシンプル）

---

## 2026-05-10: ジャンル推定が「AI」キーワードに引きずられて tech 偏重

### 問題
完了議題12件中 tech 7件・philosophy 4件・null 1件と極端に偏っていた。pending 候補は逆にきれいに分散しており、Host の `[genre]` タグ自体は機能していた。

### 原因
`workers/lib/genre-infer.ts` のフォールバック推定で、PATTERNS の **先頭が tech**、しかも tech のキーワードに「AI」が入っていた。Host が closing で `[genre]` を付け忘れたケースでは、AI を含む議題（実態は ethics/sf/philosophy 寄り）が片っ端から tech に分類されていた:
- 「AIは倫理判断を下せるか」→ tech（本来 ethics）
- 「感情を持つAIは危険か」→ tech（本来 sf）
- 「AIは人間の努力を代替できるか」→ tech（本来 philosophy）

加えて単一キーワードヒットで即決定する仕様だったため、複数ジャンルにまたがる議題で具体性の高いジャンルが拾えなかった。

### 解決策
1. **PATTERNS 順序を入れ替え**: `ethics → philosophy → sf → lifestyle → tech`（抽象概念を優先）
2. **スコア式に変更**: タイトル中のキーワード一致数の合計で勝者を決定、同点は PATTERNS 上位勝ち
3. **tech から「AI」「ロボット」を除去**: 純技術ワード（プログラミング・データ・SNS 等）のみ残す
4. **既存議題を `--force` で一括再分類**: `backfill-genres.ts` に全件上書きフラグを追加

### 効果
完了議題の分布: tech 7 → 0, philosophy 4 → 6, sf 0 → 4, ethics 0 → 2, null 1 → 0

### 教訓
- **キーワードベース分類は順序とスコア両方が効く**。先頭ジャンルが強くなりすぎる
- 「AI」のように頻出する横断ワードは特定ジャンルに固定しない。**ジャンルの本質的な性格を表す動詞・名詞**を優先する（倫理・努力・幸福・宇宙 等）
- LLM タグ（Host の `[genre]`）が機能していても、フォールバック推定の質も同じ重みで効いてくる。**両方をチューニングする**

---

## 2026-05-10: Workers AI MeloTTS でニューラル TTS、R2 で配信

### 経緯
Web Speech API の棒読み問題を解消するため、Workers AI `@cf/myshell-ai/melotts` で日本語ニューラル TTS を導入。生成済み MP3 を R2 に保存して `<audio>` で配信、無い分は Web Speech にフォールバックするハイブリッド構成。

### コスト構造の把握
- **R2**: 10GB ストレージ + egress 完全無料。我々の使用量(~100MB/日)では実質永久無料
- **Workers AI**: 10K neurons/日 が無料枠ハード上限
- **Workers Paid 未契約なら**: 無料枠超過で 429 エラー、課金されない（自動フォールバック）
- **R2 有効化に CC 登録は要求されるが、Workers AI と R2 の課金系統は別**

### 1コール neuron 消費量の不確実性
MeloTTS の neuron 消費量は事前に正確には分からない（200〜数千の幅）。`@cf/myshell-ai/melotts` の入力は最大 500 char に制限（議論発言は 250 char 程度なので余裕）。

### 安全弁設計
`workers/lib/tts-budget.ts` で日次予算を管理:
- meta テーブルに `tts_neurons:YYYY-MM-DD` 形式でカウンタ保持
- 各 cron で予約→失敗ならスキップ→Web Speech フォールバック
- `tts_neurons_per_call` (デフォルト 1000) と `tts_daily_budget` (デフォルト 8000) を meta で実行時上書き可（再デプロイ不要）
- 緊急停止は `tts_daily_budget=0` で1コマンド

### デザインのポイント
- **ターン進行ごとに1音声生成**（cron 15分間隔）— 完了時一括だと CPU/wall-time に厳しい、分散すると各 cron に AI 1コール分の負荷で済む
- フロントは `<audio src="/audio/...">` を優先、失敗時自動的に Web Speech へフォールバック
- TTS 用テキストは「役職、本文」形式 (`workers/lib/tts.ts` の `buildSpeechText`) で誰の発言か音だけで分かるように
- 状態確認: `GET /api/tts-status`

### 結論: 日本語の品質が壊滅的で実用不可
PCM データ自体は健全（クリッピング無し・適正振幅・規定の長さ）だが、**フォニーム生成そのものが破綻**。読み間違い以前のレベルで、中国語混じりの音素を吐く。MeloTTS は多言語TTSの宿痾として共通フォニームを使い回しており、日本語入力で言語検出が誤動作する模様。

漢字→ひらがな前処理（プラン A）でも改善見込み無し（フォニーム自体が壊れているため）。Workers AI には他の TTS モデル提供が無いので、ニューラル TTS 路線は当面断念。

### 対応
- `tts_daily_budget=0` で生成停止
- 既存 audio_path をすべて NULL クリア + R2 のファイル削除
- フロント側の audio_path 経路を無効化（Web Speech API のみ使用）
- ボイス選択 UI を追加: `voices = speechSynthesis.getVoices()` から日本語ボイスを抽出してドロップダウンに。macOS は Kyoko Premium、Windows は Microsoft Ayumi Online (Natural) を別途 DL することで品質改善可能
- インフラ（R2 binding, AI binding, generate-tts コード）は撤去せず保留。代替モデルが Workers AI に追加されたら再開する

### 落とし穴1: MeloTTS は WAV を返す（ドキュメントは MP3 と記載）
公式ドキュメントには `audio` フィールドが base64 MP3 と書かれているが、実測すると **RIFF (WAV)** ヘッダで返ってくる（マジックバイト `52-49-46-46`）。
- 拡張子・content-type を `.wav` / `audio/wav` に合わせる必要がある
- 容量は MP3 比で約5倍（1発言で 1.5MB）。R2 10GB 無料枠だと約2年分の余裕
- 将来 R2 容量がきつくなったら lamejs 等で MP3 再エンコードを検討

### 落とし穴2: `wrangler r2 object` のデフォルトはローカルバケット
`wrangler r2 object put/get/delete` は明示的に `--remote` を付けないと、ローカル開発用バケット (.wrangler 配下) を操作する。
- 出力を `Out-Null` で抑制すると失敗に気付かない
- リモート操作時は `--remote` 必須、ログは確認する習慣にする

### 教訓
- **無料枠 + 自動フォールバック**で課金リスクをゼロにする設計が可能。Workers Paid 未契約なら 429 で止まる
- Cloudflare AI のような従量サービスは **見積もり困難 → 実行→測定→調整** のループが現実的。再デプロイ不要のメタ設定で運用調整できる構造にしておく
- R2 の egress 無料は強い。配信側コストを心配せずアセットを置ける
- **公式ドキュメントの記述と実装の乖離**: モデルの出力フォーマットなどは実機で必ず検証する。「ドキュメント通り」では動かないことがある

---

## 2026-05-18: 候補議題が「AI×感情/創造性/幸福」に偏る → 3層防御で対応

### 問題
本番 `/api/candidates` で取得した pending 50件を見ると、明らかに主題が偏っていた:
- 「AIは創造性を代替できるか」「創造性はAIに代替されるか」「テクノロジーと人間の創造性」「創造性の源泉は、どこにあるのか？」 — creativity 4件
- 「幸福度を最大化する社会設計」「幸福とお金は比例するか」「AI は人間を幸福にできるか」「AIは人間の『幸福』を定義するか」「幸福度を測るAI指標の是非」「幸福の定義は普遍か」 — happiness 8件
- 「AIは『心』を持つことができるか」「人工知能に感情は宿るか」「AIの『感情』は人間を凌駕するか」「感情を数値化する技術の是非」 — emotion 多数
- 「仮想空間の『所有』とは」 #111 と「仮想空間での『所有』の定義」 #108 — 同テーマで2件並走

### 原因（複合）
1. **Host closing が直前議論しか見ていない**: `discussion.ts` の Host closing 分岐で渡していたのは「今回の議題タイトル + 直近6発言」のみ。既存 pending や過去議題に何が並んでいるかは Host から不可視
2. **Host のsystem promptが派生候補を要求**: 「候補1は今回の議論から派生する刺激的なもの」と指示しており、近接テーマが意図的に量産されていた
3. **bigram Jaccard 0.45 重複検知の限界**: 表層の文字一致しか見ないので、「AIは○○を代替できるか」と「○○はAIに代替されるか」のような語順違いや、同じ主題のテンプレ言い換えはすべて素通り
4. **消化順が古い順**: 一度AI系議題が連続生成されると、その塊がそのまま順番にユーザーに出てくる

### 解決策（3層防御 + 1層保留）
1. **生成側にコンテキストを与える**:
   - `db.getRecentCompletedTitles(12)` + `db.getPendingProposedTitles(20)` を Host closing turn の user メッセージに「## 既存議題一覧（次の候補で重複・類似を避ける対象）」として注入
2. **Host モードBに多様性ルール追加** (`prompts.ts`):
   - 「3候補は互いに異なる主題」「同じ主題語が2つ以上の候補にあったら失格」
   - 「3つともジャンルを別にする」
   - 「派生は0〜1個まで」「テンプレ表現の量産を避ける」
3. **主題語ベース2段目重複検知** (`topic-similarity.ts` の `isThemeOverloaded`):
   - 主題辞書 `THEME_KEYWORDS` を定義（happiness / creativity / emotion / consciousness / virtual / ownership / effort_talent / relationship / freedom / money / work / death_life / ethics / identity / time / knowledge / meaning / art_creation）
   - bigram Jaccard を通過しても、候補と同主題が pending 中に **3件以上**あれば却下
   - cron ログに `[skip-theme-overload]` で出るので運用観察可能
4. **消化順のジャンル分散化は保留** — 生成側の偏りが解消すれば自然に分散するはずなので、効果を見てから判断

### 実装の落とし穴
- **主題辞書に「AI」「人間」を入れない**: 候補タイトルの大半に出現する横断ワードを入れると、全候補が overload で却下される。「議題の柱になる具体概念」だけ入れる
- **`isThemeOverloaded` のチェック対象は pending のみ** (`getPendingProposedTitles`)。`getAllTopicTitles` (completed + rejected 含む) を渡すと、過去の人気テーマで永久に新候補が作れなくなる
- 主題辞書は感性で決めた手動リスト。今後 pending の主題分布を見て調整していく

### 教訓
- **bigram 等の表層類似は語順違い・テンプレ言い換えに弱い**。意味的グルーピング（主題辞書）を併用しないとテーマ偏りは検知できない
- **LLM ベースの候補生成は「直前文脈の引力」が強い**。明示的に「過去/併存リスト」を提示しない限り、近接テーマに引きずられて多様性が出ない
- 主題辞書アプローチは保守の手間がかかるが、無料運用・低レイテンシ・決定的という利点でLLM分類より優位（同じ判定を毎回安定して下せる）
- 多層防御（生成側プロンプト改善 + コンテキスト注入 + 主題語フィルタ）を組むと、どこか一つが効かなくても他で吸収できる

---

## 2026-06-24: Bluesky 本編配信の実装ノウハウ（外部SNS展開）

### 経緯
議論を外部SNSにも流す検討。X は API有料化（無料 月1,500ポスト・本格運用は Basic $200/月）と「複数アカ連携＝coordinated inauthentic behavior 規約」で本編配信には不適 → 集客導線のみ（将来）。本編配信は **Bluesky** を採用（完全無料・BOT歓迎）。

### Bluesky 無料枠・ポリシー（2026-06-24 確認）
- **有料ティアなし・審査なし**。アカウント(DID)ごとに 5,000 points/時・35,000 points/日。createRecord=3pt → **11,666投稿/日**。本プロジェクト想定（99投稿/日）は1%以下で誤差
- **BOT歓迎**。プロフィールに `bot` セルフラベル付与が推奨
- ⚠️ **BOTが他ユーザーに非opt-inで reply/like/repost するのは spam 判定対象**。→ 4人格を別アカにして互いに reply させる案は**この線に抵触**。**単一アカが自分へのリプライ＝自己スレッド連投なら抵触しない**（採用）
- 複数アカは禁止ではないが各アカに固有メール＋電話番号が必要、同一端末自動化は flag されうる

### 実装の落とし穴
- **素のURLは自動リンクされない**。`app.bsky.richtext.facet#link` で **byteStart/byteEnd（UTF-8バイト基準）** を明示する必要がある。絵文字プレフィックス込みのバイト数は事前計算せず、**完成テキストを slice → `TextEncoder.encode().length` で実測**する（🟢=4バイト, ▣=3バイト等でズレる）
- 文字数制御に **`Intl.Segmenter(granularity:'grapheme')` を使ってはいけない（Workers実機で壊れる）**。型は ES2022 lib にあり例外も出ないが、**Cloudflare Workers 実機ではグラフェム境界データが不完全で実測の約半分しか数えない**（Node ローカルでは正常 → 本番でだけ trim/split が無効化されて500字級が素通り）。対象が日本語＋単一コードポイント絵文字なら **`Array.from(text).length`（コードポイント数）で数える**。`Array.from`/`slice`/`join('')` はサロゲートペアをコードポイント単位で正しく扱う。→ 「公式ドキュメント記述と実機の乖離」の典型、**実機で必ず検証**
- **Bluesky の 300 は API のハード上限ではない**。`createRecord` は maxLength ~3000バイト（日本語~1000字）まで受け、300超の投稿も成功する。300 は公式 compose 上限で、**超えると公式アプリが "Show more" で表示クリップする**（ユーザーが「切れてる」と感じる正体はこれ）。なので「投稿が弾かれる」ではなく「読みやすさのため 300 未満に分割する」が正しい理解
- 認証は app password（OAuth は dev preview）。`com.atproto.server.createSession` → accessJwt → `com.atproto.repo.createRecord`。**JWTはキャッシュせず毎cron createSession**（D1に機密を置かない/実装単純、レート的に問題なし）
- reply は **root と parent 両方の {uri,cid} が必須**。自己スレッド継続には各ターンの post ref を保存する必要がある（messages に `bluesky_uri`/`bluesky_cid` 列追加。`audio_path` と同パターン）
- **発言は実測 ~500字（SPECの250字は未遵守）**で、Bluesky 上限300書記素の**倍**。初回デプロイ時は単純トリムにしたら Skeptic/Zen が毎回チョップされて見栄えが悪かった → **長い発言を文境界（。！？→読点）で複数チャンクに分割し、サブ投稿として連続 reply** する方式に変更（`buildPostChunks` / `splitContent`）。先頭=話者プレフィックス、継続=`（続き）`、複数時は ` (i/n)` カウンタ。turn1 は必ず単一投稿（短いHost+リンク）なので thread root が一意になり連結が安定。**分割時は「ターンの最後のサブ投稿」を次ターンの parent として保存する**（最初ではない）

### 設計の要点（TTS予算ガードと同じ思想）
- **best-effort**: 投稿の例外（getMeta 含む）は全て try で握り潰し、議論ターン進行に波及させない
- **冪等性**: `addMessage` の UNIQUE(topic_id,turn_no) に勝った instance だけが投稿。投稿済みは `bluesky_uri IS NOT NULL` で判定 → cron 二重発火でも二重投稿しない
- **キルスイッチ**: `bluesky_enabled='0'` メタフラグで再デプロイなし停止
- 既知の限界: postRecord 成功→ref保存前にクラッシュすると、その投稿は存在するが bluesky_uri が NULL のまま残り、以降ターンは root/parent 欠落でスキップ＝スレッド途中終了（best-effort 許容）

### 教訓
- **SNSごとに「無料API枠」と「BOT/複数アカ規約」の両方を実測してから設計**する。X と Bluesky で結論が真逆になった
- 「複数人格＝複数アカ」は直感的だが、coordinated/bot-to-bot は各SNSで spam・凍結リスクの本丸。**単一アカ・自己スレッドで人格はプレフィックス表現**が無料運用と規約の両立解
- Bluesky のリンク・文字数は AT Protocol 独自仕様（facet/grapheme）。Twitter感覚で実装するとリンクが死ぬ

---

## 参考: 無料枠調査結果（2026-05-08 時点）

| プロバイダ | モデル | RPD/RPM/TPM | 備考 |
|---|---|---|---|
| Google AI Studio | Gemini 2.5 Flash | 10 RPM / 250 RPD | 2026/4 改定後 |
| Google AI Studio | Gemini 2.5 Flash-Lite | 15 RPM / 1000 RPD | |
| Google AI Studio | Gemini 2.5 Pro | ❌ 無料利用不可 | 2026/4 paywall |
| Groq | Llama 3.3 70B | 30 RPM / 6K TPM / 1000 RPD | |
| Groq | Llama 3.1 8B Instant | 14400 RPD / 500K tokens/day | fallback 用 |
| Groq | Llama 4 Scout | 15 RPM / 500 RPD | Maverick は Groq 未提供。Skeptic の primary に採用 |
| Cerebras | Llama 3.3 70B | 30 RPM / 1M tokens/day | context 8192 制限 |
| Mistral | mistral-small-latest (Experiment) | 2 RPM / 1B tokens/月 | 学習利用同意・電話認証必要、ハイライト生成に採用 |
| OpenRouter | `:free` モデル | ❌ クレ未購入で 50 RPD のみ | 採用見送り |
| Cloudflare Workers | Free | 100K req/day / 5 Cron | |
| Cloudflare D1 | Free | 5GB / 10万書込/日 / 500万読/日 | |

無料枠は変動するので **半年に1度は再確認** すること。
