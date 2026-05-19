# ai-roundtable

複数の AI に人格を与えて、テーマについて連続議論させる様子を眺めるサイト。

詳細は [PLAN.md](./PLAN.md) / [SPEC.md](./SPEC.md) / [KNOWLEDGE.md](./KNOWLEDGE.md) を参照。

## アーキテクチャ

- **フロント**: React 19 + Vite + React Router (SPA)
- **バックエンド**: Cloudflare Workers + D1 (SQLite)
- **Cron**: Workers Cron Triggers が15分おきに発火 → 1ターンずつ議論を進める
- **LLM**: Gemini 2.5 Flash / Groq Llama 3.3 70B / Cerebras（fallback）すべて無料枠

`scripts/` (ローカル PoC) と `workers/` (本番) でロジックを共有 (`workers/lib/`)。

## Phase 1 PoC: ローカル議論ループ

### セットアップ

```bash
npm install
cp .env.example .env
# .env に各プロバイダの API キーを記入
```

### API キー取得（すべて無料、CC不要、電話番号認証不要）

3キーで全キャラが動く（Gemini と Groq は1キーで複数モデル使える）。

| プロバイダ | 取得 URL | 用途 |
|---|---|---|
| Google AI Studio | https://aistudio.google.com/apikey | Optimist (Flash) + Host (Flash-Lite) |
| Groq | https://console.groq.com/keys | Skeptic (70B) + 各 fallback (8B) |
| Cerebras | https://cloud.cerebras.ai/ | Zen (70B) |

### 議論を1議題回す

```bash
npm run discuss              # 20議題からランダム
npm run discuss -- --id 5    # 特定議題（idは data/topics.json 参照）
npm run discuss -- --title "好きなテーマ"
```

実行結果は `data/runs/{timestamp}-topic-{id}.json` に保存される。

### フロントで眺める

PoC では `public/sample-run.json` を読み込む方式。最新の実行結果を public にコピー:

```bash
# 最新 run を sample として表示
cp data/runs/最新ファイル.json public/sample-run.json
npm run dev
# http://localhost:5173/
```

## ディレクトリ構造

```
ai-roundtable/
├── prompts/         # 各キャラの system prompt
├── scripts/         # ローカル PoC
│   └── providers/   # LLM プロバイダ別ラッパー
├── data/
│   ├── topics.json  # 初期20議題
│   └── runs/        # 実行結果（gitignore）
├── src/             # フロント (React + Vite)
├── public/          # 静的アセット
└── workers/         # Phase 2 で追加（Cloudflare Workers）
```

## Phase 2: Cloudflare Workers + D1 セットアップ

### 1. Cloudflare アカウントの準備
```bash
npx wrangler login
```

### 2. D1 データベース作成
```bash
npx wrangler d1 create ai-roundtable
```
出力された `database_id` を `wrangler.toml` の `database_id = "TBD..."` に貼り付ける。

### 3. マイグレーション適用（ローカル）
```bash
npm run db:migrate:local
```

### 4. シークレット設定（本番デプロイ前）
```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put CEREBRAS_API_KEY
```

### 5. ローカルで動作確認
別ターミナルで:
```bash
npm run worker:dev    # wrangler dev (port 8787)
```
別ターミナルで:
```bash
npm run dev           # vite (port 5173) → /api/* を 8787 へ proxy
```
http://localhost:5173/ で動作確認。

### 6. 本番デプロイ
```bash
npm run db:migrate:remote   # 本番 D1 にマイグレーション適用
npm run worker:deploy       # ビルド + Workers デプロイ
```

### Cron 動作確認
ローカルで Cron を手動発火:
```bash
npx wrangler dev --test-scheduled
# 別ターミナル
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

## ディレクトリ構造

```
ai-roundtable/
├── workers/                  # Cloudflare Workers (本番)
│   ├── index.ts              # fetch + scheduled handler
│   ├── lib/
│   │   ├── prompts.ts        # 各キャラ system prompt
│   │   ├── providers.ts      # LLM プロバイダクライアント (共有)
│   │   ├── discussion.ts     # ターン進行ロジック (共有)
│   │   ├── turn-runner.ts    # Cron 用高水準ロジック
│   │   └── db.ts             # D1 ヘルパー
│   ├── api/handlers.ts       # REST API
│   └── migrations/*.sql      # D1 スキーマ・シード
├── src/                      # フロント (React + Vite)
│   ├── components/           # Sidebar, TurnList, TopicHeader
│   ├── pages/                # CurrentPage, TopicPage
│   └── api.ts                # API クライアント
├── scripts/run-discussion.ts # ローカル PoC
├── data/topics.json          # PoC 用初期議題
└── public/                   # 静的アセット
```
