# PLAN.md — ai-roundtable

## 目的
複数の AI（異なるプロバイダ・モデル）に人格を与え、特定のテーマについてリアルタイムで議論させ、その様子を観客が眺めるサイト。
コンテンツ系（simtool.dev のツール集合とは別系統）。

## コアコンセプト
- **AI人格 × 議題 × 連続議論** をひたすら垂れ流す
- ユーザーは「観客」。介入はしない（少なくとも Phase 1 では）
- 数十分に1ターン進む程度のゆっくりペース。リアルタイム性より「常に何か動いている」感
- 議論が煮詰まったら次の議題を AI が提案 → 自動切替

## 制約
- **無料運用**: 従量課金 API は使わない。各プロバイダの無料枠で回す
- **規約遵守**: AdSense/Cloudflare/各 LLM プロバイダのコンテンツポリシー違反テーマは扱わない（暴力・違法行為の助長・差別等）
- **ブラウザ自動化禁止**: ChatGPT/Claude.ai 等の WebUI を Selenium 等で叩く運用は TOS 違反のため不採用

## 技術選定（暫定）
- **フロント**: React + Vite + TypeScript（既存パターン）
- **デプロイ**: Cloudflare Pages
- **バックエンド**: Cloudflare Workers + KV（無料枠）
- **議論ループ駆動**: Cloudflare Workers Cron Triggers（数十分おき）
- **LLM プロバイダ（候補）**:
  - Google AI Studio（Gemini Flash）
  - Groq（Llama 3.3 70B / DeepSeek R1 distill）
  - OpenRouter `:free` モデル
  - Mistral 無料枠
  - Cerebras 無料枠
- **収益化**: AdSense（Phase 2 以降。低トラフィック時は載せない）

## フェーズ
- **Phase 0**: 仕様策定（本フェーズ）
- **Phase 1**: PoC — ローカルで議論ループを 1 回手動実行 → JSON 出力 → 静的フロントで表示
- **Phase 2**: Cloudflare Workers Cron で自動化、KV に蓄積、フロントから読む
- **Phase 3**: 議題自動切替、AdSense、SEO

## 公開先（暫定）
- `roundtable.simtool.dev`（既存ドメインのサブドメイン運用）

## 今後の議論ポイント（SPEC で詰める）
- AI 人格の設計（何人？どういうキャラ？）
- 1ターンの粒度（1発言？1往復？）
- KV のデータ構造
- 無料枠が枯渇したときの fallback
- 初期議題のリスト
