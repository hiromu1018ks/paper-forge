# タスク一覧

## 優先: 開発サーバーを動かす

- [x] リポジトリ骨格の準備  
  実装方針: `frontend/` と `backend/` ディレクトリを作成し、Go と Vite の初期設定（`go.mod`、`pnpm init`）を行う。ルートに `.env.example` を配置して要件定義で指定されたキー（`APP_USERNAME` など）をまとめ、ローカル向け `.env.local` のテンプレ雛形を作る。参照: `docs/01_requirements.md`, `docs/02_basic_design.md`.
- [x] フロントエンド開発環境の初期化  
  実装方針: `docs/03_ui_spec.md` に沿って Vite + React + TypeScript プロジェクトを生成し、React Router、Zustand、TanStack Query、Axios、React Hook Form を導入して画面遷移・状態管理・フォーム送信を支える。`design.html` を参照しつつベースレイアウトと共通コンポーネント（ボタン、カード、モーダル）を整える。参照: `docs/03_ui_spec.md`, `docs/design.html`.
- [x] バックエンドAPIサーバーの雛形実装  
  実装方針: `docs/02_basic_design.md` の構成に合わせて Gin を初期化し、`cmd/api/main.go` と `internal/{auth,pdf,jobs,storage}` の空実装を用意する。ローカル開発では GCS の代わりに `/tmp/app/<jobId>/` を使う設定を `config` パッケージに定義し、CORS・セッション・CSRF ミドルウェアを差し込む。参照: `docs/02_basic_design.md`, `docs/04_api_spec.md`.
- [x] ローカル開発用の認証・セッション処理  
  実装方針: `docs/04_api_spec.md` の `/auth/login` と `/auth/logout` を実装し、`APP_USERNAME` と `APP_PASSWORD_HASH` を使って bcrypt 照合する。`gin-contrib/sessions` で `Secure; HttpOnly; SameSite=Strict` なクッキーを発行し、`github.com/utrack/gin-csrf` で `X-CSRF-Token` を返す。参照: `docs/01_requirements.md`, `docs/04_api_spec.md`.
- [x] PDF結合API（同期処理）の実装  
  実装方針: 要件定義の 5.1 に従い `POST /pdf/merge` の `multipart/form-data` を実装し、アップロードファイルを一時ディレクトリへ保存して pdfcpu の Merge API を呼び出す。処理前にファイルサイズとページ数を検証し、生成ファイルはストリームで返す。`JOB_EXPIRE_MINUTES` に従って一時ファイル削除ジョブを仕込む。参照: `docs/01_requirements.md`, `docs/04_api_spec.md`.
- [x] フロントエンドのログイン〜結合フロー  
  実装方針: 画面仕様 S-01〜S-03 をもとにログインフォーム、ダッシュボード、結合画面を作成し、Zustand で `auth` と `workspace` ストアを用意する。Axios で `/auth/login` と `/pdf/merge` を呼び出し、プログレスバーは同期完了までの疑似ステップ (`load/process/write`) を表示する。参照: `docs/03_ui_spec.md`, `docs/04_api_spec.md`.  
  完了メモ (2025-10-18): React Router を導入して `/login` → `/app` のフローを保護し、Mergeタブでの結合完了時に疑似進捗とワークスペース保存を含む一連の体験を実装。ログアウト時はストアと永続化データをクリア。
- [x] ワークスペース画面と結果保持  
  実装方針: S-07 を踏まえて結果プレビューとダウンロードボタンを持つワークスペース画面を実装し、`workspace.lastResult` に結合結果の `Blob` または URL を保持する。続けて処理する導線（圧縮/分割/順序）にはプレースホルダーを配置して今後の拡張に備える。参照: `docs/03_ui_spec.md`.  
  完了メモ (2025-10-18): `workspaceStore` を新設し、結果 Blob を IndexedDB に永続化。S-07 準拠の `WorkspacePage` を追加し、プレビュー・ダウンロード・続きの処理ボタンを実装。

## フォローアップ候補（開発サーバー安定後）

- [ ] 他のPDF操作（順序入替・分割・圧縮）の実装  
  実装方針: 要件 5.2〜5.4 に沿って pdfcpu / Ghostscript を呼び出すハンドラを追加し、UI では S-04〜S-06 を拡張する。参照: `docs/01_requirements.md`, `docs/02_basic_design.md`, `docs/03_ui_spec.md`, `docs/04_api_spec.md`.
- [ ] 非同期ジョブと進捗API  
  実装方針: Asynq を導入して長時間処理をジョブ化し、`GET /jobs/{id}` で進捗を返すロジックを `internal/jobs` に実装する。フロントはポーリングを TanStack Query で制御する。参照: `docs/01_requirements.md`, `docs/02_basic_design.md`, `docs/04_api_spec.md`.
- [ ] GCS 署名付きURLによる大容量アップロード  
  実装方針: `POST /uploads/signed-url` を実装し、フロントで GCS 直PUTフローを追加する。ローカルでは MinIO などを用いて API 契約を模倣する。参照: `docs/01_requirements.md`, `docs/02_basic_design.md`, `docs/04_api_spec.md`, `docs/05_deploy_guide.md`.
- [ ] 自動テストとCIの整備  
  実装方針: Go のユニットテストで範囲パーサやページ検証をカバーし、フロントは Vitest + React Testing Library を導入する。GitHub Actions で lint/test を自動実行する。参照: `docs/01_requirements.md`, `docs/02_basic_design.md`, `docs/05_deploy_guide.md`.
