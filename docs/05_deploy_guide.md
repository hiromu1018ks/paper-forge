# デプロイ手順書 v1.0（Cloud Run / Vercel / GCS）

対象: 要件定義 v1.1 ／ 基本設計 v1.0
最終更新: 2025-10-12

---

## 0. 前提

* フロント: Vercel（静的配信）
* API: Cloud Run（Go + Gin + pdfcpu）
* ストレージ: GCS（直PUT/GET用・短期保管）
* 認証: アプリ内ログイン（Cookie: `Secure; HttpOnly; SameSite=Strict`）
* 同一サイト運用: `app.example.com`（Vercel） と `api.example.com`（Cloud Run）は **同一 eTLD+1**（`example.com`）に置く（SameSite=Strict維持のため）

---

## 1. リポジトリ構成（例）

```
repo/
  frontend/           # React + Vite
  backend/            # Go 1.22 + Gin
    cmd/api/main.go
    internal/{auth,pdf,jobs,uploads,storage}
    go.mod
    Dockerfile
  .github/workflows/{api-deploy.yml,frontend-deploy.yml}
```

---

## 2. GCP 初期設定

### 2.1 プロジェクトとAPI

```bash
# プロジェクト選択
PROJECT_ID=your-project
REGION=asia-northeast1

gcloud config set project $PROJECT_ID

# 必要API
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  storage.googleapis.com
```

### 2.2 Artifact Registry（コンテナ用）

```bash
# リポジトリ作成（Docker）
gcloud artifacts repositories create api-repo \
  --repository-format=docker --location=$REGION --description="pdf-tools api"

# 認証
gcloud auth configure-docker $REGION-docker.pkg.dev
```

### 2.3 GCS バケット

```bash
BUCKET=pdf-tools-${PROJECT_ID}

gsutil mb -l $REGION gs://$BUCKET/

# ライフサイクル: 1時間で自動削除（uploads, jobs配下）
cat > lifecycle.json <<'JSON'
{
  "rule": [
    {"action": {"type": "Delete"}, "condition": {"age": 1, "matchesPrefix": ["uploads/", "jobs/"]}}
  ]
}
JSON

gsutil lifecycle set lifecycle.json gs://$BUCKET/
```

### 2.4 サービスアカウント（Cloud Run 用）

```bash
SA=pdf-tools-api

gcloud iam service-accounts create $SA \
  --display-name="pdf tools api"

# 署名URL発行のため（鍵なしV4署名）
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$SA@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator

# GCS への最小権限（アップロード/取得/削除）
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$SA@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin

# Secret Manager から値を読み取るための権限
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$SA@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

> 備考: 署名URLのV4署名を**サービスアカウント鍵なし**で行う場合、`roles/iam.serviceAccountTokenCreator` が必要。鍵を使う実装にするなら不要だが鍵管理が増える。

### 2.5 セッション署名鍵の登録（Secret Manager）

```bash
SECRET_NAME=session-secret

openssl rand -hex 32 | gcloud secrets create $SECRET_NAME \
  --replication-policy=automatic \
  --data-file=-  # 初回のみ実行

# 鍵のローテーション（例: 四半期）
openssl rand -hex 32 | gcloud secrets versions add $SECRET_NAME --data-file=-
```

### 運用メモ

- 追加されたバージョンは `gcloud secrets versions list $SECRET_NAME` で確認し、利用中でない古い鍵は `gcloud secrets versions disable <version>` で無効化する。  
- Cloud Run から参照するときは `--set-secrets SESSION_SECRET=projects/$PROJECT_ID/secrets/$SECRET_NAME:latest` のように指定し、常に最新バージョンを読み込む。  
- ローカル開発では `cp .env.local.example .env.local` の上で `SESSION_SECRET` に Secret Manager から取得した値を貼り付ける。`.env.local` は `.gitignore` で除外し、リポジトリへコミットしない。  
- `gcloud secrets versions add` を定期的（四半期など）に実行し、更新後に Cloud Run を再デプロイして新バージョンの環境変数が渡っていることを確認する。  
- GitHub Actions 等でデプロイする場合は、同じ `--set-secrets` オプションをワークフローに加えておく。

> 運用メモ: `create` は最初の一度だけ。以降の更新は `versions add` を使い、古いバージョンは `gcloud secrets versions disable` で無効化する。ローカル開発では `.env.local` 等に `SESSION_SECRET` を記載し、リポジトリへコミットしない。

### 2.6 Cloud Memorystore（Redis）

```bash
REDIS_INSTANCE=pdf-tools-redis

gcloud redis instances create $REDIS_INSTANCE \
  --size=1 \
  --region=$REGION \
  --tier=STANDARD_HA

# 接続文字列取得
REDIS_HOST=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format='value(host)')
REDIS_PORT=$(gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --format='value(port)')

# Cloud Run で利用する環境変数例
QUEUE_REDIS_URL="redis://$REDIS_HOST:$REDIS_PORT"
```

> Asynq で進捗管理を行うため、Cloud Memorystore（Redis）を必ずプロビジョニングし、取得したホスト・ポートを `QUEUE_REDIS_URL` として Cloud Run に渡してください。開発環境では Docker 版 Redis などでも代替できますが、本番ではマネージドサービスを推奨します。

---

## 3. バックエンド（Cloud Run）

### 3.1 Dockerfile（例）

```Dockerfile
# backend/Dockerfile
FROM golang:1.22-bookworm AS build
WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends ghostscript \
  && rm -rf /var/lib/apt/lists/*
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /workspace/bin/server ./cmd/api

FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=build /workspace/bin/server ./server
COPY --from=build /usr/bin/gs /usr/bin/gs
COPY --from=build /usr/lib/x86_64-linux-gnu/libgs.so.* /usr/lib/x86_64-linux-gnu/
ENV GIN_MODE=release \
    PATH="/app:${PATH}"
EXPOSE 8080
ENTRYPOINT ["./server"]
```

> メモ: 圧縮機能で Ghostscript を利用するため、ビルドステージで `apt-get install ghostscript` を実行し、バイナリと共有ライブラリ（`libgs.so.*`）を最終イメージへコピーしています。distroless ベースでは `apt` が使用できないため、このマルチステージ手順が必須です。`GOARCH` は Cloud Run のターゲットに合わせて調整してください。

### 3.2 ビルド & プッシュ

```bash
IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/api-repo/pdf-tools-api:$(date +%Y%m%d-%H%M%S)

docker build -t $IMAGE backend/
docker push $IMAGE
```

### 3.3 デプロイ

```bash
API_DOMAIN=api.example.com

gcloud run deploy pdf-tools-api \
  --image=$IMAGE \
  --region=$REGION \
  --platform=managed \
  --service-account=$SA@$PROJECT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --cpu=2 --memory=2Gi \
  --max-instances=2 --min-instances=0 \
  --port=8080 \
  --set-env-vars=GCP_PROJECT=$PROJECT_ID,GCS_BUCKET=$BUCKET,MAX_FILE_SIZE=104857600,MAX_PAGES=200,JOB_EXPIRE_MINUTES=10 \
  --set-secrets=SESSION_SECRET=projects/$PROJECT_ID/secrets/session-secret:latest

# カスタムドメイン（マッピング）
gcloud run domain-mappings create --service=pdf-tools-api --domain=$API_DOMAIN --region=$REGION
# 指示に従いDNSにTXT/CAA/CNAME等を設定
```

### 3.4 環境変数（追加）

* `APP_USERNAME`, `APP_PASSWORD_HASH`（bcrypt）
* `CORS_ALLOWED_ORIGIN=https://app.example.com`（同一サイトなら不要）
* `SESSION_SECRET`（Secret Manager から注入。ローカルは `.env.local` で管理）
* `GIN_MODE=release`
* `QUEUE_REDIS_URL=redis://<host>:6379`（Asynq 用）

---

## 4. フロント（Vercel）

### 4.1 設定

* Project Link: `frontend/`
* Environment Variables

    * `VITE_API_BASE_URL=https://api.example.com/api`
    * （必要に応じ）`VITE_DEPLOY_TAG`
* Build Command: `pnpm i && pnpm build`
* Output: `dist/`

### 4.2 カスタムドメイン

* `app.example.com` を Vercel に割当（A/AAAA or CNAME）。
* HTTPS は Vercel が自動発行。

### 4.3 SameSite の確認

* `app.example.com` と `api.example.com` は **同一サイト**（`example.com` が eTLD+1）
* Cookie の `SameSite=Strict` がそのまま有効（クロスサイト扱いにならない）

---

## 5. CORS/CSRF 設計

* 原則: **同一サイト**で運用（CORSなし）
* 別ドメイン運用が必要な場合のみ CORS を明示（Allow-Origin を固定）。
* CSRF: ログイン後にヘッダ `X-CSRF-Token` をフロントが保存・送信。Cookieは `HttpOnly` のため JS から参照しない。

---

## 6. GCS 署名URL（実装指針）

* 発行API: `POST /uploads/signed-url { filename, size, contentType }`
* 返却: `{ uploadUrl, objectPath, expiresAt }`
* PUT 時のヘッダ: `Content-Type: application/pdf`
* `objectPath` 例: `gs://$BUCKET/uploads/<uuid>/<filename>`
* 取り回し: 処理APIには **GCSパス**（`gs://...`）を渡す。結果も `jobs/<jobId>/out/` に保存し、**署名付きGET URL** を返す。

---

## 7. セキュリティ/IAM

* Cloud Run サービスアカウントに以下ロール（最小権限）

    * `roles/storage.objectAdmin`（対象バケット限定）
    * `roles/iam.serviceAccountTokenCreator`（V4署名に必要）
* バケットポリシー: プロジェクト単位公開は**禁止**。署名URLでのみアクセス。
* HTTP ヘッダ: `Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`

---

## 8. CI/CD（GitHub Actions 例）

### 8.1 API デプロイ `.github/workflows/api-deploy.yml`

```yaml
name: api-deploy
on:
  push:
    paths: ["backend/**"]
    branches: [ main ]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write   # Workload Identity Federation
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.DEPLOY_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Configure Docker
        run: gcloud auth configure-docker ${{ vars.REGION }}-docker.pkg.dev -q
      - name: Build & Push
        run: |
          IMAGE=${{ vars.REGION }}-docker.pkg.dev/${{ vars.PROJECT_ID }}/api-repo/pdf-tools-api:${{ github.sha }}
          docker build -t $IMAGE backend
          docker push $IMAGE
          echo "IMAGE=$IMAGE" >> $GITHUB_ENV
      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy pdf-tools-api \
            --image=$IMAGE \
            --region=${{ vars.REGION }} \
            --platform=managed \
            --service-account=${{ secrets.DEPLOY_SA }} \
            --allow-unauthenticated \
            --cpu=2 --memory=2Gi \
            --port=8080 \
            --set-env-vars=GCP_PROJECT=${{ vars.PROJECT_ID }},GCS_BUCKET=${{ vars.BUCKET }} \
            --set-secrets=SESSION_SECRET=projects/${{ vars.PROJECT_ID }}/secrets/session-secret:latest
```

> Secrets: GitHub Actions では `SESSION_SECRET` を直接取り扱わず、Cloud Run が Secret Manager から読み込む。ローカルでCIを再現する場合のみ一時ファイルに書き出し、テスト後に削除する。

### 8.2 Front デプロイ `.github/workflows/frontend-deploy.yml`

```yaml
name: frontend-deploy
on:
  push:
    paths: ["frontend/**"]
    branches: [ main ]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm i --frozen-lockfile
        working-directory: frontend
      - run: pnpm build
        working-directory: frontend
      # 実運用は Vercel Git 連携を推奨（自動プレビュー/本番反映）
```

---

## 9. 環境変数一覧（まとめ）

| 変数                    | 例                             | 用途           |
| --------------------- | ----------------------------- | ------------ |
| `APP_USERNAME`        | `admin`                       | ログインID       |
| `APP_PASSWORD_HASH`   | `$2b$12$...`                  | bcrypt ハッシュ  |
| `GCP_PROJECT`         | `your-project`                | GCP プロジェクトID |
| `GCS_BUCKET`          | `pdf-tools-your-project`      | 対象バケット       |
| `MAX_FILE_SIZE`       | `104857600`                   | 100MB        |
| `MAX_PAGES`           | `200`                         | 上限頁          |
| `JOB_EXPIRE_MINUTES`  | `10`                          | 一時領域削除       |
| `SESSION_SECRET`      | `projects/.../secrets/session-secret` | セッション署名鍵（Secret Manager 保管・四半期ローテーション） |
| `CORS_ALLOWED_ORIGIN` | `https://app.example.com`     | 別ドメイン時のみ     |
| `VITE_API_BASE_URL`   | `https://api.example.com/api` | Front向け      |

---

## 10. 動作確認（スモーク）

```bash
# 1) ログイン
curl -i -c cookie.txt -X POST https://api.example.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"***"}'
# レスポンスヘッダの X-CSRF-Token を保存

# 2) 署名URL
CSRF=... # レスポンスから取得
curl -s -b cookie.txt -X POST https://api.example.com/api/uploads/signed-url \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"filename":"a.pdf","size":123456,"contentType":"application/pdf"}'

# 3) 直PUT（GCS）
# uploadUrl に対して Content-Type: application/pdf で PUT

# 4) 結合を非同期投入
curl -s -b cookie.txt -X POST https://api.example.com/api/pdf/merge \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"inputs":["gs://pdf-tools-your-project/uploads/uuid/a.pdf"],"order":[0]}'

# 5) 進捗取得
curl -s -b cookie.txt https://api.example.com/api/jobs/<jobId>
```

---

## 11. ロールバック

* Cloud Run: 以前のリビジョンにトラフィックを切替（`gcloud run services update-traffic ...`）
* Vercel: 以前のデプロイを `Promote to Production`
* GCS: 重要ファイルはバージョニング無効（短期保管前提）。必要に応じて一時的に有効化。

---

## 12. 運用メモ

* 進捗APIの失敗は即時再試行（指数バックオフ）
* 長時間ジョブの多発時は Cloud Run の `max-instances` を一時引上げ
* バケットのライフサイクルは**短すぎるとユーザーがDL前に消える**ため注意（1〜2h推奨）
* カスタムドメインの DNS 伝播に時間がかかる場合あり（事前にTXT検証を通す）
