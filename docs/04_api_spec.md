# API仕様詳細 v1.0

対象: 基本設計 v1.0 / 要件定義 v1.1 準拠
最終更新: 2025-10-12

---

## 0. 総則

* ベースURL: `/api`
* 認証: **セッションクッキー**（`Secure; HttpOnly; SameSite=Strict`）
* CSRF: 状態変更系で `X-CSRF-Token` ヘッダ必須
* レスポンス形式: `application/json`（バイナリ返却時を除く）
* タイムアウト目安: 同期 120s（超過は非同期へ切替）
* 上限: 1ファイル ≤ **100MB**, 1ファイル ≤ **200頁**, リクエスト合計 ≤ **300MB**
* 進捗: `GET /jobs/{jobId}` で 1–2s 間隔でポーリング
* CORS: 同一オリジン推奨。異なる場合は API 側で許可オリジンを固定
* セッション署名鍵: `SESSION_SECRET` を Secret Manager に保存し、Cloud Run は `--set-secrets` で注入（四半期ローテーション）

---

## 1. 共通スキーマ

```ts
// Error
interface ApiError { code: string; message: string; details?: Record<string, any>; }

// Job
type JobStatus = 'queued'|'running'|'done'|'error';
interface JobInfo {
  jobId: string;
  status: JobStatus;
  progress: number; // 0..100
  downloadUrl?: string; // done時のみ
  error?: ApiError;     // error時
}
```

---

## 2. 認証

### 2.1 POST /auth/login

* Req Body: `{ "username": string, "password": string }`
* Res: `204 No Content`

    * Set-Cookie: セッションクッキー
    * Header: `X-CSRF-Token: <token>`
* 4xx: `401 INVALID_CREDENTIALS`, `429 TOO_MANY_ATTEMPTS`

### 2.2 POST /auth/logout

* Req: ヘッダ `X-CSRF-Token`
* Res: `204 No Content`

---

## 3. アップロード（大容量向け）

### 3.1 POST /uploads/signed-url

* 認証必須 / CSRF必須
* Req

```json
{ "filename": "report.pdf", "size": 73400320, "contentType": "application/pdf" }
```

* Res

```json
{ "uploadUrl": "https://storage.googleapis.com/...", "objectPath": "gs://bucket/uploads/uuid/report.pdf", "expiresAt": "2025-10-12T12:34:56Z" }
```

* 注意: 署名URLは **単回PUT** を想定。フロントは `PUT uploadUrl` で直送。

---

## 4. PDF処理

### 4.1 POST /pdf/merge

* 用途: 複数PDFを結合
* 認証/CSRF: 必須
* 方式A（小容量）`multipart/form-data`

    * `files[]`: PDF 複数
    * `order` (任意): JSON配列（0-based または 1-based 仕様は 0-based に固定）
* 方式B（大容量）`application/json`

```json
{ "inputs": ["gs://bucket/a.pdf", "gs://bucket/b.pdf"], "order": [0,1] }
```

* Res

    * 同期: `200 application/pdf`（バイナリ）。ヘッダー `Content-Disposition`, `X-Job-Id`
    * 非同期: `202 Accepted` `{ "jobId": "..." }`
* 4xx: `400 INVALID_INPUT`, `413 LIMIT_EXCEEDED`, `400 UNSUPPORTED_PDF`

### 4.2 POST /pdf/reorder

* 用途: 単一PDFのページ順入替
* 方式A（小容量）`multipart/form-data`

    * `file`: PDF
    * `order`: JSON配列（0-based）例 `"[0,2,1]"`
* 方式B（大容量）`application/json`

```json
{ "input": "gs://bucket/in.pdf", "order": [0,2,1] }
```

> UI 表示は1ページ目を1として扱うが、API は常に 0-based index を受け付ける。フロントエンドで送信前に変換する。

* Res: 同 / 非同期はファイルサイズ・処理時間で切替（同期時は `Content-Disposition`, `X-Job-Id` ヘッダーを返却）

### 4.3 POST /pdf/split

* 用途: 範囲指定で分割（zip出力）
* 方式A（小容量）`multipart/form-data` → `file`, `ranges="1-3,7,10-"`
* 方式B（大容量）JSON

```json
{ "input": "gs://bucket/in.pdf", "ranges": "1-3,7,10-" }
```

* Res: 同期 `200 application/zip`（`Content-Disposition`, `X-Job-Id`） / 非同期 `202 { jobId }`

### 4.4 POST /pdf/optimize

* 用途: 圧縮（最適化）
* ボディ

```json
{ "input": "gs://bucket/in.pdf", "preset": "standard" }
```

* `preset`: `standard`（10–20%減）, `aggressive`（30–50%減）
* Res: 同期 `200 application/pdf`（`Content-Disposition`, `X-Job-Id`） / 非同期 `202 { jobId }`

---

## 5. ジョブ

### 5.1 POST /jobs/{type}

* 用途: 任意処理を非同期投入（UIから明示的にキュー投入したい場合）
* Req: 処理種別 `type in {merge|reorder|split|optimize}` とパラメータ
* Res: `202 { jobId }`

### 5.2 GET /jobs/{jobId}

* Res

```json
{
  "jobId": "JOB-123",
  "operation": "merge",
  "status": "running",
  "progress": {
    "percent": 42,
    "stage": "process",
    "message": "pdfcpu merging"
  },
  "downloadUrl": null,
  "meta": {
    "totalPages": 120,
    "sources": [
      { "name": "doc-a.pdf", "size": 1048576, "pages": 60 },
      { "name": "doc-b.pdf", "size": 524288, "pages": 60 }
    ]
  },
  "updatedAt": "2025-10-18T02:34:56Z"
}
```

* `status`: `queued|running|done|error`
* `progress`: 0–100%。`stage` は `queued|load|process|write|completed`
* `downloadUrl`: 成功時は `/api/jobs/{id}/download` または署名付きURL
* `meta`: 処理種別ごとのメタデータ（`MergeMeta`, `SplitMeta`, など）。失敗時は省略

### 5.3 進捗の定義

* 内部ステップ: `queued` → `load(0-20)` → `process(20-80)` → `write(80-100)` → `completed`
* `process` はページ数や入力数で加重。**単調増加**を保証。
* `message` はバックエンド側のステータス文字列（デバッグ用途）。未設定の場合もある。

### 5.4 GET /jobs/{jobId}/download

* 用途: 成功したジョブの成果物をダウンロード
* Res: `200 OK` + バイナリ（PDF/ZIP）。ヘッダー `Content-Disposition`, `Cache-Control: no-store`
* エラー: `404 JOB_RESULT_NOT_FOUND`（TTL切れなど）、`400 INVALID_INPUT`

---

## 6. エラーコード表

| code                | http | 典型メッセージ        | 原因                 | 対処         |
| ------------------- | ---- | -------------- | ------------------ | ---------- |
| INVALID_CREDENTIALS | 401  | 認証に失敗しました      | ユーザー/パス誤り          | 入力を確認      |
| TOO_MANY_ATTEMPTS   | 429  | 試行回数が多すぎます     | レート制限              | 時間を置く      |
| UNAUTHORIZED        | 401  | ログインが必要です      | Cookie無/期限切れ       | 再ログイン      |
| FORBIDDEN           | 403  | CSRFトークンが不正です  | CSRF欠如/不一致         | 再読み込み後に実行  |
| INVALID_INPUT       | 400  | 入力が正しくありません    | order/ranges等の形式誤り | 入力修正       |
| INVALID_RANGE       | 400  | 範囲の形式が正しくありません | ranges 解析失敗（空/昇順違反等） | 入力修正       |
| LIMIT_EXCEEDED      | 413  | 上限を超えています      | サイズ/ページ数超過         | ファイルを分割    |
| UNSUPPORTED_PDF     | 400  | PDFを処理できません    | 破損/非対応バージョン        | PDFを修復     |
| JOB_NOT_FOUND       | 404  | ジョブが見つかりません    | 期限切れ/無効ID          | もう一度実行     |
| INTERNAL            | 500  | サーバーエラーが発生しました | 予期せぬ例外             | リトライ/問い合わせ |

---

## 7. ヘッダ仕様

* 要求時

    * `X-CSRF-Token`: 状態変更系
    * `Idempotency-Key`（任意）: **重複送信防止**（同一キー + 同一ボディなら重複受付しない）
* 応答時

    * `X-Request-Id`: 監査ID
    * `Content-Disposition`: バイナリ返却時（`attachment; filename="result.pdf"` 等）
    * `X-RateLimit-Remaining` / `X-RateLimit-Reset`（ログイン試行時）

---

## 8. 入力検証（詳細）

* PDF検証: 拡張子 `.pdf` / `application/pdf` / シグネチャ `%PDF-`
* ページ順: 0..N-1 を**重複なく全列挙**（受信時に0-basedで検証）
* 範囲: 正規表現 `^\d+(-\d+)?(,\d+(-\d+)?)*-?$`
* GCSパス: `^gs://[a-z0-9\-\._/]+$`

---

## 9. セキュリティ備考

* セッションは `Secure; HttpOnly; SameSite=Strict`
* CSP例: `default-src 'self'; img-src 'self' blob:; connect-src 'self' https://storage.googleapis.com;`
* 署名URLは短寿命（例: 10–30分）。アクセスは**1回限り**想定。
* GCSのライフサイクルでオブジェクトは短期削除（例: 1時間）

---

## 10. 例（curl）

```bash
# ログイン（CSRF受領）
curl -i -c cookie.txt -X POST https://api.example.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"user","password":"pass"}'
# レスポンスヘッダの X-CSRF-Token を保存する

# 署名URL発行
curl -i -b cookie.txt -X POST https://api.example.com/api/uploads/signed-url \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"filename":"a.pdf","size":123456,"contentType":"application/pdf"}'

# 直PUT（GCS署名URLに対して）
curl -X PUT "$UPLOAD_URL" -H 'Content-Type: application/pdf' --data-binary @a.pdf

# 結合を非同期投入
curl -i -b cookie.txt -X POST https://api.example.com/api/pdf/merge \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"inputs":["gs://bucket/a.pdf","gs://bucket/b.pdf"],"order":[0,1]}'

# 進捗取得
curl -s -b cookie.txt https://api.example.com/api/jobs/$JOB_ID | jq
```

---

## 11. OpenAPI（抜粋）

```yaml
openapi: 3.0.3
info: { title: pdf-tools api, version: 1.0.0 }
servers: [{ url: /api }]
paths:
  /auth/login:
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties: { username: {type: string}, password: {type: string} }
              required: [username, password]
      responses:
        '204': { description: success }
        '401': { description: invalid credentials }
  /uploads/signed-url:
    post:
      security: [{ cookieAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                filename: { type: string }
                size: { type: integer, maximum: 104857600 }
                contentType: { type: string, enum: [application/pdf] }
              required: [filename, size, contentType]
      responses:
        '200': { description: signed url issued }
  /pdf/merge:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                inputs: { type: array, items: { type: string, pattern: '^gs://.*' } }
                order: { type: array, items: { type: integer } }
              required: [inputs]
      responses:
        '200': { description: pdf binary }
        '202': { description: accepted job }
  /jobs/{jobId}:
    get:
      parameters:
        - in: path
          name: jobId
          required: true
          schema: { type: string }
      responses:
        '200':
          description: job info
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/JobInfo'
components:
  schemas:
    JobInfo:
      type: object
      properties:
        jobId: { type: string }
        status: { type: string, enum: [queued, running, done, error] }
        progress: { type: integer, minimum: 0, maximum: 100 }
        downloadUrl: { type: string }
        error:
          type: object
          properties: { code: {type: string}, message: {type: string} }
  securitySchemes:
    cookieAuth:
      type: apiKey
      in: cookie
      name: session
```

---

## 12. 実装ノート

* `Idempotency-Key` はストア不要の短期メモリキャッシュで十分（有効 2–5分）
* 同期レスポンス時の `Content-Disposition` は UTF-8 ファイル名対応（RFC 5987）
* ジョブ `downloadUrl` は署名URL（GET 1回）を返す。フロントは**自動DLしない**
* ログにファイル内容は含めない。ハッシュは先頭8桁のみ
