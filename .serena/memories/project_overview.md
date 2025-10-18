# Paper Forge Overview
- WebアプリでPDFの結合・順序入替・分割・圧縮を提供。
- フロントエンド: React 18 + TypeScript + Vite。状態管理にZustand、データ取得にTanStack Query、HTTPはAxios。
- バックエンド: Go 1.22 + Gin。PDF処理にpdfcpu、圧縮にGhostscript（予定）、ジョブ管理にAsynq（予定）。
- ドキュメントはdocs配下で要件・設計・API仕様を管理。
- 開発ターゲット: 個人利用向けの自己ホスト/公開運用。