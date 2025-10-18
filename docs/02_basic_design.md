# 基本設計書 v1.0（React + Go/Gin + GCS + Cloud Run）

最終更新: 2025-10-12 / 対象: 要件定義 v1.1 準拠

---

## 0. 目的

要件定義 v1.1 を実装するための**構造・API・フロー・設定**を確定する。

---

## 1. 全体アーキテクチャ

```
[Browser]
   │  (1) /app 静的配信
   ▼
[Vercel: Front]
   │  (2) /api/uploads/signed-url 要求
   ▼
[Cloud Run: API (Go+Gin)] ─── (3) 署名URL発行 ───► [GCS Bucket]
   ▲                                          ▲
   │(5) 処理依頼(JSON: gcs://...)
   │                                          │(4) 直PUT (巨大PDF)
   │                                          ▼
   ├── (6) GCSから読込 → pdfcpu/Ghostscriptで処理 → 結果をGCSへ保存
   └── (7) ジョブ進捗/結果URL を返却
```

* サムネイル: ブラウザで必要分のみ逐次生成（PDF.js）
* ダウンロード: 自動開始しない。結果をワークスペースに保持し、ユーザー操作でDL/次処理

---

## 2. 画面構成・状態遷移

### 2.1 主要画面

1. **ログイン**

* 入力: username/password
* 出力: セッションクッキー / CSRFトークン

2. **ダッシュボード**

* 操作カード: 結合 / 分割 / 順序 / 圧縮

3. **編集画面（機能共通）**

* アップロード（小: 直送 / 大: 署名URL→GCS直PUT）
* サムネイル: 無限スクロールで逐次描画
* DnD: ファイル順/ページ順
* 実行ボタン: 処理種別ごとに有効
* 進捗バー: 0–100%

4. **結果/ワークスペース**

* プレビュー（代表ページ）
* ダウンロードボタン
* 「続けて…」: 結合→圧縮 等のチェーン

> UI のコンポーネント配置や配色は `docs/design.html` のデザイン案と合わせて確認する。

### 2.2 クライアント状態（Zustandなど）

* `auth`: { isLoggedIn, csrfToken, user }
* `workspace`: { inputRefs: File[]|GCSPath[], lastResultRef: {type, gcsPath|blobUrl, meta}, history[] }
* `jobs`: Map<jobId, {status, progress, resultUrl?, error?}>

---

## 3. API 仕様（詳細）

ベース: `/api`（Cloud Run）

### 3.0 共通

* 認証: セッションクッキー必須（`Secure; HttpOnly; SameSite=Strict`）
* CSRF: 状態変更系は `X-CSRF-Token`
* エラー: `{ code, message }` JSON
* 上限: 100MB / 200頁 / リクエスト合計300MB

### 3.1 認証

* `POST /auth/login`

    * Req: `{ "username":"...", "password":"..." }`
    * Res: `204`（Set-Cookie発行）, ヘッダ `X-CSRF-Token`
* `POST /auth/logout` → `204`

### 3.2 署名URL

* `POST /uploads/signed-url`

    * Req: `{ filename, size, contentType }`
    * Res: `{ uploadUrl, objectPath, expiresAt }`
    * 備考: `objectPath = gs://<bucket>/uploads/<uuid>/<filename>`

### 3.3 結合

* 小容量: `multipart/form-data`（`files[]`, 任意 `order`）
* 大容量: `POST /pdf/merge` JSON

  ```json
  { "inputs": ["gs://bucket/a.pdf", "gs://bucket/b.pdf"], "order": [0,1] }
  ```
* Res: 小容量は `200 application/pdf`、大容量・長時間は `202 { jobId }`

### 3.4 順序入替

* `POST /pdf/reorder`

    * form: `file`, `order="[0,2,1,...]"`（0-based index）
    * or JSON: `{ input: "gs://...", order: [0,2,1,...] }`
    * Res: `200 pdf` or `202 { jobId }`

### 3.5 分割

* `POST /pdf/split`

    * form: `file`, `ranges="1-3,7,10-"`
    * or JSON: `{ input: "gs://...", ranges: "1-3,7,10-" }`
    * Res: `200 application/zip` or `202 { jobId }`

### 3.6 圧縮

* `POST /pdf/optimize`

    * form or JSON: `{ input: "gs://...", preset: "standard"|"aggressive" }`
    * 削減目安: standard 10–20%、aggressive 30–50%
    * Res: `200 pdf` or `202 { jobId }`

### 3.7 ジョブ進捗・結果

* `GET /jobs/{jobId}`

    * Res:

  ```json
  {
    "status": "queued|running|done|error",
    "progress": 0,
    "downloadUrl": "https://..." ,
    "error": {"code":"...","message":"..."}
  }
  ```
* 進捗算出（例）: 読込20% / 処理60% / 書込20% を内部ステップで加算

---

## 4. バリデーション/ビジネスルール

* PDF検証: 拡張子・MIME・シグネチャ一致
* ページ順: 欠落/重複を禁止（APIは0-based整数配列を受け取り、UIで1-based表示から変換）
* 範囲パース: `1-3,7,10-` 形式（昇順、重複除外）
* 上限超過: `413 LIMIT_EXCEEDED`
* 破損PDF: `400 UNSUPPORTED_PDF`

---

## 5. セキュリティ

* 認証: `APP_USERNAME` + `APP_PASSWORD_HASH(bcrypt)`
* セッション: サーバー署名Cookie、12h / アイドル30m
* CSRF: ダブルサブミット（Cookie + ヘッダ）
* CORS: カスタムドメインで同一オリジン推奨。異なる場合は許可オリジン固定。
* GCS: 署名付きURL（PUT/GET）、最小権限（専用SA）。
* ライフサイクル: アップロード/出力を短期自動削除（例: 1h）
* ヘッダ: `CSP`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`

---

## 6. サムネイル/プレビュー設計

* ライブラリ: PDF.js（WebWorker利用）
* 描画戦略: 無限スクロール + ビューポート外は破棄（仮想化）
* 画質/速度: `scale` と `renderingQueue` を調整。メモリ使用量の上限管理。

---

## 7. サーバ実装（Go + Gin）

* ディレクトリ構成（`backend/`）

    * `cmd/api/`: エントリーポイント（環境変数読込・DI・Router起動）
    * `internal/auth/`: セッション管理（`gin-contrib/sessions`）と CSRF ミドルウェア、レート制限
    * `internal/uploads/`: 署名付き URL サービスとハンドラ
    * `internal/pdf/`: pdfcpu を用いた PDF 操作ロジック + Ghostscript ラッパー
    * `internal/jobs/`: Asynq キュー/ワーカーで進捗と非同期実行を管理
    * `internal/storage/`: GCS I/O 抽象化と署名付き URL 生成

> 運用方針: 初期は Redis（`redis-stack`）を Cloud Memorystore で運用し、Asynq のジョブ状態を永続化する。接続情報は環境変数で管理し、導入時に可用性テストを実施する。

* PDF 処理実装の例

    * `pdf.MergeCreateFile(output, inputs...)` で pdfcpu の API を用いて結合
    * `pdf.ReorderPages(ctx, reader, order)` でページ順並べ替え
    * `pdf.SplitRanges(ctx, reader, ranges)` で複数ファイルを生成
    * `pdf.OptimizeWithGhostscript(ctx, tempFile, preset)` で Ghostscript CLI を `exec.CommandContext` から実行

* 一時領域: `/tmp/app/<jobID>/in|out` に保存し、ジョブ完了または 10 分で削除

---

## 8. 進捗の実装詳細

* ステップ法（推奨）

    * `queued` → `load`(0→20) → `process`(20→80) → `write`(80→100) → `completed`
    * `process` 内でページ数に応じて分割計測し、`percent` は単調増加にする
* クライアントは `GET /jobs/{id}` を 1–2 秒間隔でポーリングし、完了後は `/jobs/{id}/download` から成果物を取得
* `Store` は Redis にジョブJSONを保存（キー `job:<id>`、TTL = `JOB_EXPIRE_MINUTES`）し、Asynq ワーカーは結果完了時にメタデータを格納

---

## 9. ログ/監査

* 形式: JSON（stdout）
* 共通フィールド: `ts, requestId, user, ip, ua, op, size, pages, ms, sha8`
* 認証ログ: 成功/失敗/ロックアウト
* 例外ログ: スタックトレース + `op`/`jobId`

---

## 10. 設定・環境変数

* アプリ

    * `APP_USERNAME`, `APP_PASSWORD_HASH`
    * `SESSION_SECRET`（128bit以上。Secret Manager で管理し、Cloud Run へ `--set-secrets` で注入。四半期ごとにバージョンを追加）
    * `CORS_ALLOWED_ORIGINS`
    * `MAX_FILE_SIZE`, `MAX_PAGES`
    * `JOB_EXPIRE_MINUTES`（成果物 TTL と一致）
    * `QUEUE_REDIS_URL`（Asynq / 進捗ストア）
    * `ASYNC_THRESHOLD_BYTES` / `ASYNC_THRESHOLD_PAGES`（同期 → 非同期の切替条件）
    * `GHOSTSCRIPT_PATH`（ローカル環境では `gs`）
    * `JOB_RESULT_BASE_URL`（外部ストレージを使用する場合の署名URLベース）
* GCP

    * `GCP_PROJECT`, `GCS_BUCKET`
    * `SERVICE_ACCOUNT`（最小権限: Storage Object Admin 相当 / 署名限定）

---

## 11. デプロイ

### 11.1 Cloud Run（API）

* コンテナ: `Dockerfile`（Go 1.22 multi-stage: builder → distroless/base-debian12）
* メモリ/CPU: 入力サイズに応じて調整（例: 1–2 vCPU, 1–2GB）
* 最小インスタンス: 0（コールドスタート許容）
* 認可: 未認証呼出し許可（アプリ内認証が前段） or IAP 併用も可

### 11.2 Vercel（Front）

* 環境変数: `NEXT_PUBLIC_API_BASE_URL` 等
* キャッシュ: 静的ビルド

### 11.3 GCS

* バケット作成（リージョンはCloud Runと合わせる）
* ライフサイクル: `age < 2h` で削除、失敗時はクリーンナップジョブ

---

## 12. エラーハンドリング（UI/サーバ）

* UI: 入力バリデーションは即時表示（範囲、順序、上限）
* 進捗APIが `error` → トースト + 詳細ダイアログ
* 再試行: ネットワーク断は指数バックオフ、ジョブは再実行リンク表示

---

## 13. テスト計画（抜粋）

* 単体: 範囲パーサ、順序検証、サイズ上限、CSRFミドルウェア
* 結合: GCS直PUT→結合→圧縮チェーン、進捗%の単調増加
* 負荷: 100MB/200頁で各操作120秒以内
* 異常: 破損PDF、巨大画像、タイムアウト、部分失敗（zip生成）

---

## 14. 今後の拡張（要件優先）

* パスワード付与/解除（`qpdf` CLI を Go から呼び出す）
* 透かし（pdfcpu のスタンプ機能でテキスト/画像透かしを埋め込む）
* ページ追加/削除（pdfcpu の import/remove API を利用）
* メタ情報編集（Title/Author 等）

---

## 付録A: 型定義（例）

```ts
// Front（Zustand）
export type JobStatus = 'queued'|'running'|'done'|'error';
export type JobInfo = { id: string; status: JobStatus; progress: number; downloadUrl?: string; error?: {code:string; message:string} };

export type Workspace = {
  inputRefs: (File | { gcsPath: string; name: string; size: number })[];
  lastResult?: { type: 'pdf'|'zip'; ref: { blobUrl?: string; gcsPath?: string }; meta?: any };
};
```

```go
// Server（進捗表現）
type Progress struct {
  Step    string `json:"step"`
  Current int    `json:"current"`
  Total   int    `json:"total"`
}
```
