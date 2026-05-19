# CLAUDE.md — ai-roundtable

This file provides guidance to Claude Code when working in this project.

## What this is

複数の AI（異なるプロバイダ・モデル）に人格を与え、テーマについて連続議論させる様子を観客が眺めるサイト。
**コンテンツ系プロジェクト**。simtool.dev のツール集合とは別系統で、エンタメ寄り。

詳細は PLAN.md / SPEC.md を参照。

## Stack（暫定）

- React 19 + Vite + TypeScript
- Cloudflare Pages（フロント）
- Cloudflare Workers + KV または D1（バックエンド）
- Cloudflare Workers Cron Triggers（ターン駆動）
- 複数 LLM プロバイダの無料 API（Gemini, Groq, OpenRouter, Mistral 等）

## Conventions

### 絶対原則
- **従量課金 API は使わない**（無料枠のみ）。新プロバイダ追加時は無料枠の有無を必ず確認
- **規約遵守**: AdSense・各 LLM プロバイダ・Cloudflare のコンテンツポリシーを守る。暴力・違法・差別を扱わない
- **ブラウザ自動化禁止**: WebUI を Selenium 等で叩く実装はしない（TOS違反）

### 議論ジャンル
SPEC.md「規約セーフな議題ジャンル」セクションに沿う。NG ジャンルは採用しない。

### コード構成
- `src/` フロント
- `workers/` Cloudflare Workers バックエンド
- `prompts/` 各 AI キャラの system prompt（バージョン管理対象）
- `scripts/` ローカル PoC 用スクリプト

### State 永続化
- 議論ログは KV または D1 に保存
- フロントは API 経由で取得、ブラウザ側に永続化する状態は最小限

## Commands（後で確定）

```bash
npm run dev          # Vite dev
npm run build        # Vite build
npm run lint         # ESLint
npm run worker:dev   # wrangler dev
npm run worker:deploy
```

## ドキュメント運用

ルート `~/.claude/CLAUDE.md` のルールに従う。
- **TODO.md**: タスク着手・完了のたびに即更新
- **SPEC.md**: 仕様議論ごとに追記、決定事項を「決定事項ログ」に明記
- **PLAN.md**: フェーズ進行・方針変更で更新
- **KNOWLEDGE.md**: ハマったら即追記（無料枠制限・プロバイダ固有の癖など）
