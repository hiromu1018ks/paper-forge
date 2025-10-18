# Paper Forge

PDF操作ツール（結合・分割・順序入替・圧縮）のWebアプリケーション

## 📋 概要

Paper Forgeは、PDFファイルの結合、ページ順入替、分割、圧縮を行うWebアプリケーションです。
フロントエンドにReact + Vite、バックエンドにGo + Ginを使用し、個人利用を想定した設計になっています。

## 🛠 技術スタック

### フロントエンド
- **React 18** - UIライブラリ
- **TypeScript** - 型安全性
- **Vite** - 高速ビルドツール
- **React Router** - ルーティング
- **Zustand** - 状態管理
- **TanStack Query** - データフェッチング
- **Axios** - HTTPクライアント
- **React Hook Form** - フォーム管理

### バックエンド
- **Go 1.22+** - プログラミング言語
- **Gin** - Webフレームワーク
- **pdfcpu** - PDF操作ライブラリ
- **Ghostscript** - PDF圧縮（予定）
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

## 🚀 開発の流れ

このプロジェクトは以下の順序で開発を進めます：

1. **リポジトリ骨格の準備** ✓
   - ディレクトリ構成の作成
   - 設定ファイルの配置

2. **フロントエンド開発環境の初期化**（次のステップ）
   - Viteプロジェクトのセットアップ
   - 必要なライブラリのインストール
   - 基本的なルーティングと状態管理の設定

3. **バックエンドAPIサーバーの雛形実装**
   - Go modulesの初期化
   - Ginサーバーの基本設定
   - ヘルスチェックと認証エンドポイントの実装

4. **機能実装**（今後）
   - ログイン機能
   - PDF結合機能
   - その他のPDF操作機能

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
go run ./cmd/api  # サーバー起動
```

APIサーバーが http://localhost:8080 で起動

**ヘルスチェック:**
```bash
curl http://localhost:8080/health
# {"service":"paper-forge-api","status":"ok","version":"0.1.0"}
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

# テスト（予定）
go test ./...

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

## 🔒 セキュリティ

- すべての通信はHTTPSを使用（本番環境）
- bcryptによるパスワードハッシュ化（cost=12）
- セッション署名Cookie（Secure, HttpOnly, SameSite=Strict）
- CSRF保護（ダブルサブミット方式）
- ファイルアップロード時の検証（拡張子・MIME・シグネチャ）

## 📄 ライセンス

Apache-2.0

## 🤝 コントリビューション

このプロジェクトは個人利用を想定していますが、改善提案は歓迎します。

---

**現在の開発状況**:
- ✅ リポジトリ骨格の準備完了
- ✅ フロントエンド開発環境の初期化完了
- ✅ バックエンドAPIサーバーの雛形実装完了
- 🚧 次のステップ: ログイン機能とPDF操作機能の実装
