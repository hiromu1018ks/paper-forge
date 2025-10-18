# よく使うコマンド
- `cd frontend && pnpm install` : フロントエンド依存をインストール。
- `cd frontend && pnpm dev` : フロント開発サーバー起動。
- `cd frontend && pnpm build` : フロントをビルド。
- `cd frontend && pnpm lint` : TypeScript/ReactのLintを実行。
- `cd backend && go run ./cmd/api` : APIサーバーを起動。
- `cd backend && go build -o app ./cmd/api` : バックエンドをビルド。
- `cd backend && go test ./...` : Goユニットテスト（今後追加予定）。
- `cd backend && go fmt ./...` : Goコードのフォーマット。