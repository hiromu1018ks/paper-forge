# Paper Forge

PDF操作ツール（結合・分割・順序入替・圧縮）のWebアプリケーション

## 📋 概要

Paper Forge は、PDFファイルの結合・ページ順入替・分割・圧縮をブラウザから実行できる Web アプリケーションです。大きなファイルは Redis + Asynq を用いた非同期ジョブで処理し、進捗を 1–2 秒間隔でポーリングして確認できます。フロントエンドは React + Vite、バックエンドは Go + Gin を採用しています。

## 🛠 技術スタック

### フロントエンド
- **React 19** - UIライブラリ
- **TypeScript** - 型安全性
- **Vite** - 高速ビルドツール
- **React Router** - ルーティング
- **Zustand** - 状態管理
- **TanStack Query** - 同期 / 非同期ジョブの状態管理とポーリング
- **Axios** - HTTPクライアント
- **React Hook Form** - フォーム管理

### バックエンド
- **Go 1.22+** - プログラミング言語
- **Gin** - Webフレームワーク
- **pdfcpu** - PDF操作ライブラリ
- **Ghostscript** - PDF圧縮ラッパー（`gs` コマンド）
- **Asynq + Redis** - 非同期ジョブキューと進捗管理
- **bcrypt** - パスワードハッシュ化

### 開発ツール
- **pnpm 9+** - Node.jsパッケージマネージャー
- **Node.js 20+** - JavaScript実行環境
- **Git** - バージョン管理

## 📁 ディレクトリ構成

```
paper-forge/
├── frontend/          # フロントエンドアプリケーション (React + Vite)
│   ├── src/
│   │   ├── components/   # 共通コンポーネント
│   │   ├── pages/        # 画面コンポーネント
│   │   ├── stores/       # Zustand状態管理
│   │   ├── api/          # API通信
│   │   ├── hooks/        # カスタムフック
│   │   ├── types/        # 型定義
│   │   └── utils/        # ユーティリティ
│   ├── package.json
│   └── vite.config.ts
│
├── backend/           # バックエンドAPIサーバー (Go + Gin)
│   ├── cmd/
│   │   └── api/          # エントリーポイント (main.go)
│   ├── internal/
│   │   ├── auth/         # 認証・認可
│   │   ├── pdf/          # PDF操作ロジック
│   │   ├── jobs/         # 非同期ジョブ管理
│   │   ├── storage/      # ストレージ抽象化
│   │   └── config/       # 設定管理
│   ├── go.mod
│   └── go.sum
│
├── docs/              # ドキュメント
│   ├── 01_requirements.md    # 要件定義
│   ├── 02_basic_design.md    # 基本設計
│   ├── 03_ui_spec.md         # 画面仕様
│   ├── 04_api_spec.md        # API仕様
│   ├── 05_deploy_guide.md    # デプロイガイド
│   ├── tasks.md              # タスク一覧
│   └── design.html           # デザイン案
│
├── .gitignore
├── .env.example       # 環境変数テンプレート
└── README.md          # このファイル
```

## ✨ 主な機能

- PDF 結合（並び替え付き、即時 or 非同期自動切替）
- ページ順入替（1-based 入力 → 0-based に変換して送信）
- 範囲分割（`1-3,7,10-` のような範囲文字列をサポート）
- 圧縮（Ghostscript プリセット `standard` / `aggressive`）
- 非同期ジョブ管理（Asynq + Redis / 進捗ポーリング / ダウンロード API）
- ワークスペース履歴（結果メタデータ・Blob を IndexedDB に保存）

## ⚙️ セットアップ

### 前提条件

以下のツールがインストールされていることを確認してください：

- **Go 1.22以上**: `go version`
- **Node.js 20以上**: `node --version`
- **pnpm 9以上**: `pnpm --version`

インストールされていない場合：
```bash
# pnpmのインストール (Node.jsがインストール済みの場合)
npm install -g pnpm
```

### 環境変数の設定

1. `.env.example` をコピーして `.env.local` を作成：
   ```bash
   cp .env.example .env.local
   ```

2. `.env.local` を編集し、必要な値を設定：
   ```bash
   # 最低限必要な設定
   APP_USERNAME=admin
   APP_PASSWORD_HASH=<bcryptハッシュ>
   SESSION_SECRET=<ランダムな文字列>
   ```

   パスワードハッシュの生成方法：
   ```bash
   # オンラインツールを使用: https://bcrypt-generator.com/
   # または Go でコード実行
   ```

   セッションシークレットの生成方法：
   ```bash
   openssl rand -hex 32
   ```

### 依存サービスの起動

1. **Redis**（ジョブキュー用）

   ```bash
   docker run --rm -p 6379:6379 redis:7
   ```

2. **Ghostscript**（PDF圧縮）

   macOS / Linux の場合は `brew install ghostscript` 等でインストールし、`which gs` でパスを確認してください。Windows の場合は公式バイナリをインストールし、環境変数 `GHOSTSCRIPT_PATH` に設定します。

### フロントエンドのセットアップ

```bash
cd frontend
pnpm install  # 依存関係のインストール
pnpm dev      # 開発サーバー起動
```

ブラウザで http://localhost:5173 を開く

### バックエンドのセットアップ

```bash
cd backend
go mod download   # 依存関係のダウンロード

# 環境変数例（bash）
export QUEUE_REDIS_URL="redis://127.0.0.1:6379/0"
export GHOSTSCRIPT_PATH="$(which gs)"

go run ./cmd/api  # サーバー起動
```

API サーバーは http://localhost:8080 で起動し、PDF 操作 API と `/api/jobs/*` エンドポイントを提供します。

**ヘルスチェック:**
```bash
curl http://localhost:8080/health
# {"service":"paper-forge-api","status":"ok","version":"0.1.0"}
```

**ログインテスト:**
```bash
curl -i -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<APP_USERNAME>","password":"<平文パスワード>"}'
# 204 No Content と共に X-CSRF-Token ヘッダーが返り、セッションCookieが保存されます

# 返ってきた Cookie と X-CSRF-Token を使って保護された API を叩く例
curl -i -X POST http://localhost:8080/api/auth/logout \
  -H "X-CSRF-Token: <取得したトークン>" \
  -H "Cookie: pf_session=<レスポンスの Set-Cookie 値>"
```

## 📝 開発コマンド

### フロントエンド

```bash
cd frontend

# 開発サーバー起動
pnpm dev

# ビルド
pnpm build

# プレビュー
pnpm preview

# Lint
pnpm lint
```

### バックエンド

```bash
cd backend

# 開発サーバー起動
go run ./cmd/api

# ビルド
go build -o app ./cmd/api

# テスト
GOCACHE=$(pwd)/.gocache go test ./...

# フォーマット
go fmt ./...
```

## 📚 ドキュメント

詳細な仕様は `docs/` ディレクトリを参照してください：

- [要件定義](docs/01_requirements.md) - 機能要件・非機能要件
- [基本設計](docs/02_basic_design.md) - アーキテクチャ・API設計
- [画面仕様](docs/03_ui_spec.md) - UI/UX仕様
- [API仕様](docs/04_api_spec.md) - エンドポイント詳細
- [デプロイガイド](docs/05_deploy_guide.md) - 本番環境構築手順

## 🔒 セキュリティ / 運用メモ

- すべての通信は HTTPS を使用（本番環境）
- bcrypt によるパスワードハッシュ化（cost=12）
- セッション署名 Cookie（Secure, HttpOnly, SameSite=Strict）
- CSRF トークンは `X-CSRF-Token` ヘッダーで送信
- ファイルアップロード時の検証（拡張子・MIME・`%PDF-` シグネチャ）
- 非同期ジョブ結果は `/tmp/app/<jobId>` に 10 分保存後クリーンアップ
- `JOB_RESULT_BASE_URL` を設定すれば CDN / GCS の署名 URL を返却可能

## 📄 ライセンス

Apache-2.0

## 🤝 コントリビューション

このプロジェクトは個人利用を想定していますが、改善提案は歓迎します。

---

**現在の開発状況**

- ✅ 認証 / CSRF 対応済み
- ✅ PDF 結合・入替・分割・圧縮 + 非同期ジョブ導線を実装
- ✅ フロントエンドのジョブポーリング・ワークスペース連携を実装
- 🚧 次のステップ: 自動テスト整備 / ドキュメント拡充 / デプロイ環境整備
