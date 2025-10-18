# PDF ツール（React + Go/Gin + pdfcpu）要件定義 v1.1

最終更新: 2025-10-12 / 対象: 個人利用（他端末アクセス可）

---

## 0. 背景・目的

Web UI から PDF を **結合／ページ順入替／分割／圧縮** できるツールを提供する。フロントは React、バックエンドは Go（Gin + pdfcpu + Ghostscript）。**他端末からも利用可能**な公開構成を前提とする。4つの操作はどれも単体で使えることを前提とし、ユーザーは結合から始めずとも必要な処理だけを実行できる。

---

## 1. スコープ

* **対象操作**: ①結合 ②ページ順入替 ③分割 ④圧縮（最適化）
* **対象ファイル**: PDF 1.4〜2.0（破損はエラー）
* **利用形態**: 個人運用（外部公開だが利用者は本人）

---

## 2. 用語

* **ジョブ**: サーバーで実行する PDF 処理単位。**進捗を持つ**。
* **最適化**: Ghostscript での再圧縮（画像ダウンサンプリング、不要オブジェクト削除 等）。
* **ワークスペース**: 直前の処理結果をブラウザ側で保持し、**続けて別処理**（例: 結合→圧縮）できる一時状態。

---

## 3. 運用構成（デプロイ）

* **推奨構成（分離）**

    * **フロント**: Vercel（静的配信）
    * **API**: Cloud Run（Go + Gin + pdfcpu/Ghostscript をコンテナ化）
    * **ストレージ**: Google Cloud Storage（GCS）※大容量アップ/ダウンロードに使用
* **データフロー**

    1. フロント→API: 署名付きURLの発行依頼
    2. ブラウザ→GCS: PDFを**直接アップロード**（大型対応）
    3. フロント→API: GCSパスを指定して処理依頼（同期 or 非同期）
    4. API: GCSから読込→処理→**結果をGCSに保存**
    5. フロント: 署名付きURLでダウンロード or **ワークスペースに保持**し次操作へ
* **代替**: Cloud Run単独（フロントとAPI同居）。必要なら後で置換可。
* **通信**: 常時HTTPS（Let’s Encrypt/Cloud Runマネージド）。
* **公開**: 最小限の公開範囲（IP制限または認証必須）。

---

## 4. ユーザーストーリー

1. 単一PDFの**ページ範囲を指定して分割**し、必要な部分だけを取り出す。
2. PDFの**ページ順序をドラッグ&ドロップ**で変更し再出力する。
3. 複数PDFをアップロードし、**結合**して1つのPDFを得る。
4. PDFサイズを**圧縮**して共有しやすくする。
5. 結果を**ワークスペースに保持**し、必要に応じて別の操作（例: 分割→圧縮）を続けて実行する。

---

## 5. 機能要件

### 5.1 結合（Merge）

* 入力: 複数PDF（N ≤ 20）
* 出力: 結合済みPDF（既定名: `merged.pdf`）
* 並び替え: フロントのDnD順（`files[]`の順）または `order` 配列（指定時は優先、**0-based**）
* オプション: しおり保持（可能範囲）、メタデータ継承（先頭ファイル優先）
* 進捗: ジョブ進捗（0–100%）をポーリングで返す

### 5.2 ページ順入替（Reorder）

* 入力: 単一PDF + 新順序（整数配列, **0-based**。UIは送信時に1ページ目を0として扱う）
* 出力: 並び替え済PDF
* バリデーション: 重複/欠落の検知（厳格）
* 進捗: 有

### 5.3 分割（Split）

* 入力: 単一PDF + 範囲指定文字列（例: `1-3,7,10-`）
* 出力: 複数PDF（zip一括）
* 仕様: 範囲は昇順解釈、重複ページは1回のみ出力
* 進捗: 有

### 5.4 圧縮（Optimize）

* 入力: 単一PDF + プリセット `standard` / `aggressive`
* 出力: 最適化済PDF（`optimized.pdf`）
* 目安削減率: `standard`=10–20%、`aggressive`=30–50%
* 進捗: 有

### 5.5 プレビュー

* サムネイル生成: **必要な分だけ逐次生成**（オンデマンド）
* ページプレビュー: 複数ページ対応（遅延読込）

### 5.6 入出力制限

* 単一ファイル: **最大100MB / 200ページ**
* リクエスト合計: 最大300MB
* タイムアウト: 同期ジョブ 120秒。超過想定は非同期へ自動切替

### 5.7 ワークスペースとダウンロード

* 結果は**自動ダウンロードしない**。
* 画面で結果を**ワークスペースに保持**し、ユーザーが

    * 「ダウンロード」ボタンで保存
    * 「続けて…」メニューから**圧縮/分割/順序入替**を選択 を実行できる。

---

## 6. 認証・認可

* 方式: **アプリ内ログイン（厳格）**

    * 環境変数: `APP_USERNAME`（平文）, `APP_PASSWORD_HASH`（bcrypt, cost=12）, `SESSION_SECRET`（128bit 以上・Secret Manager 管理）
    * セッション: サーバー署名Cookie（`Secure; HttpOnly; SameSite=Strict`）
    * 期限: 有効12h / アイドル30m
    * CSRF: ログイン後に `X-CSRF-Token` を要求（ダブルサブミット）
    * レート制限: ログイン試行 5回/15分/IP（超過は10分ロック）
    * 監査ログ: 成功/失敗（ユーザー名、IP、UA、回数、結果）
* CORS: VercelフロントとCloud Run APIの**同一ドメイン運用**を推奨（カスタムドメイン）。異なる場合は許可オリジンを厳格指定。

---

## 7. 非機能要件

* パフォーマンス: 100MB/200頁を120秒以内を目安（同期）。超過は非同期で完了通知。
* 可用性: 単一ノード運用（再実行で復旧）
* セキュリティ:

    * 常時HTTPS
    * アップロード拡張子・MIME・シグネチャの3点チェック
    * 一時領域: `/tmp/app/<jobID>/` → **ダウンロード後または10分で削除**
    * GCS: 署名付きURL、**ライフサイクルで自動削除**（例: 1時間）
    * セッション署名鍵: Secret Manager で保管し、Cloud Run には `--set-secrets` で注入（四半期でローテーション）
* プライバシー: ファイル内容を保存しない方針（メタのみ）
* ログ: 処理種別、入力サイズ、ページ数、処理時間、SHA-256先頭8桁

---

## 8. API 仕様

ベースURL: `/api`

### 8.0 認証

* `POST /auth/login` → `204`（セッションクッキー発行）
* `POST /auth/logout` → `204`（無効化）
* 認可: `/pdf/*` 要ログイン。`X-CSRF-Token` 必須。

### 8.1 アップロード（大型向け）

* `POST /uploads/signed-url` → `{ uploadUrl, objectPath, expiresAt }`
* クライアントは `PUT uploadUrl` に直接アップロード。

### 8.2 結合

* `POST /pdf/merge`

    * small: `multipart/form-data`（`files[]` / 任意 `order`。0-based index）
    * large: JSON `{ inputs: ["gcs://bucket/key.pdf", ...], order?: [...] }`（0-based index）
    * 同期成功: `200 application/pdf`（小容量時）
    * 非同期投入: `202 { jobId }`

### 8.3 順入替

* `POST /pdf/reorder`

    * body: `multipart/form-data`（`file`, `order=[0,2,1,...]`）または JSON（GCSパス。0-based index）
    * 成功: 同上

### 8.4 分割

* `POST /pdf/split`

    * body: `multipart/form-data`（`file`, `ranges="1-3,7,10-"`）または JSON（GCSパス, ranges）
    * 成功: `200 application/zip`（小）/ `202 { jobId }`（大）

### 8.5 圧縮

* `POST /pdf/optimize`

    * body: `multipart/form-data`（`file`, `preset=standard|aggressive`）または JSON（GCSパス, preset）
    * 成功: `200 application/pdf` / `202 { jobId }`

### 8.6 ジョブ進捗

* `POST /jobs/{type}` → `{ jobId }`
* `GET /jobs/{jobId}` → `{ status: queued|running|done|error, progress: 0..100, downloadUrl?: string, error?: {code,message} }`

### 8.7 エラー例

```json
{ "code": "INVALID_RANGE", "message": "ranges format is invalid" }
{ "code": "UNSUPPORTED_PDF", "message": "corrupted or unsupported PDF version" }
{ "code": "LIMIT_EXCEEDED", "message": "file/page limit exceeded" }
```

---

## 9. データモデル（一時領域/GCS）

```
/tmp/app/
  └── <jobID>/
       ├── in/
       ├── out/
       └── meta.json   // {type, createdAt, files[], pages, size, preset}
```

* ワーカー: 10分以上経過のjobを削除
* GCS: `gs://<bucket>/jobs/<jobID>/{in,out}/...`（ライフサイクルで短期削除）

---

## 10. フロントエンド要件（React + Vite）

* 主要画面 0) **ログイン**: ユーザー名/パスワード、誤りやロックアウトの表示

    1. **ダッシュボード**: 操作タイル（結合/分割/順序/圧縮）を並列に配置し、どの機能からでも開始できる導線を用意
    2. **編集画面**: アップロード → サムネイル（**逐次生成**）→ DnD（ファイル順/ページ順）→ 実行
    3. **結果画面/ワークスペース**: 進捗バー、結果のプレビュー、**ダウンロードボタン**、**続けて実行**（圧縮/分割/順序）
* UX

    * 範囲入力の即時バリデーション
    * 進捗バー（%表示）。大容量時は非同期化と通知
    * 「続けて…」メニューで**チェーン実行**（例: 結合→圧縮）
    * 詳細なレイアウトや配色は `docs/design.html` に示すデザイン案に準拠

---

## 11. バックエンド要件（Go + Gin + pdfcpu）

* Go 1.22 / Gin 1.10 / pdfcpu / Asynq（Redis）/ Ghostscript 10 / go-playground/validator
* 実装要点

    * 認証: `golang.org/x/crypto/bcrypt` でハッシュ照合し、`gin-contrib/sessions`（secure cookie store）で署名付きセッション Cookie を保持、`/pdf/*` を保護
    * CSRF: `github.com/utrack/gin-csrf` で `X-CSRF-Token`（Cookie + ヘッダ）のダブルサブミット方式を強制
    * GCS連携: `cloud.google.com/go/storage` と `iamcredentials` API を使用して署名付きURLを発行、I/O を抽象化
    * 処理: pdfcpu（Goライブラリ）で結合・順序入替・分割を実装し、Ghostscript（`gs` CLI）を使って圧縮プリセット `standard` / `aggressive` を提供
    * 入力検証: `github.com/go-playground/validator/v10` でページ数/範囲/重複・欠落/上限を検証
    * 応答: 小容量はストリーミング、大容量は GCS 保存 URL を返却
    * 一時ファイル: `/tmp/app/<jobId>/` に集約し、ジョブ完了後/10分で削除
    * 進捗: 読込/処理/書込ステップを Asynq のジョブ状態で測定し百分率化

---

## 12. セキュリティ・法務

* PDF内容は保存しない（メタのみ）。
* ログはメタ情報（サイズ等）のみ。
* OSSライセンス表記（Apache-2.0）をAboutに明記。
* ヘッダー強化: `Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`。

---

## 13. 品質保証（テスト）

* ユニット: 範囲パーサ、並べ替え検証、サイズ上限
* ゴールデンファイル: 結合/分割/圧縮のハッシュ比較
* E2E: 100MB/200頁の各操作
* 異常系: 破損PDF、0バイト、過大ページ、無効範囲
* 進捗: 長時間ジョブの%推移と完了検証

---

## 14. 受け入れ基準（サンプル）

* [Auth] 正しい資格でログイン可。誤り5回で `429`（一定時間ロック）
* [Auth] 未ログインで `/api/pdf/*` は `401`。CSRF欠如で `403`。
* [Merge] UIのDnD順（`files[]`順 or `order`）で結合される。
* [Reorder] 欠落・重複なし。
* [Split] `1-2,5,8-` → 3出力（末尾は最終頁まで）。
* [Optimize] 標準: 10–20%減、強力: 30–50%減（サンプルで確認）。
* [Limits] 上限超過で `413` + `LIMIT_EXCEEDED`。
* [Workspace] 結果は自動DLせず、**ボタンでDL**。続けて処理が実行できる。
* [Cleanup] DL後または10分で一時ファイル削除。GCSはライフサイクルで自動削除。

---

## 15. 運用・デプロイ

* Cloud Run（API）: CPU常時/アイドル、メモリは処理サイズに応じて設定。
* Vercel（フロント）: ビルド時生成。環境変数でAPIエンドポイント/ドメイン注入。
* GCS: バケットに短期ライフサイクル（例: 1h削除）。
* ログ: stdout(JSON) → ローテーション。

---

## 16. 拡張候補（優先）

* **パスワード付与/解除**
* **透かし**
* ページ追加/削除
* メタ情報編集（タイトル等）
