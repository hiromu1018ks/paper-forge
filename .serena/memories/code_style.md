# コードスタイル
- TypeScript: ESLint設定は@eslint/js・typescript-eslint推奨構成、React Hooks/Refreshプラグインを適用。ソースはViteのESM構成、`src/`配下にcomponents/pages/stores/api等を配置。
- TypeScriptビルドは`tsconfig.app.json`で管理、strictな型設定が前提。
- Go: ginベースの一般的な構成。`internal/`配下でドメインごとにパッケージ分割。標準の`gofmt`/`go fmt`で整形する。
- 認証・セキュリティ関連コードにはコメントが豊富で、同様に重要処理には明瞭なコメントを保つ方針。