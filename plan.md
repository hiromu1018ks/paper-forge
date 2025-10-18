## 1. 全体像 (Big Picture)

### 目的 (Goal)
`POST /api/pdf/merge` の同期版 API を実装し、複数 PDF を安全に結合して即時ダウンロードできるようにする。ファイル検証・一時保存・結合処理・レスポンス生成までを一貫して整え、将来の非同期処理やGCS対応にも拡張しやすい構造を整備する。

### 背景 (Context)
`docs/01_requirements.md` 5.1 と `docs/04_api_spec.md` 4.1 で PDF 結合機能の要件が定義されているが、`backend/internal/pdf/merge.go` や `cmd/api/main.go` にはまだ実装がない。既存の認証ミドルウェアや設定 (`config.Config`) を活用しつつ、pdfcpu を導入して同期処理のベースラインを構築する必要がある。

---

## 2. ToDoリストと進捗 (To-Do List & Progress)

### ToDo (待機中/未着手)
- [ ] 仕様確認と要件チェックリスト作成（docs/01_requirements.md, docs/04_api_spec.md）
- [ ] pdfcpu を `backend/go.mod` に追加し、検証用サンプルコードを作成
- [ ] `internal/pdf` に結合サービス（入力検証・一時保存・結合・クリーニング）を実装
- [ ] Gin ルートに `/api/pdf/merge` ハンドラーを追加しレスポンス生成を確認
- [ ] バリデーション・エラーハンドリングのテストケース作成
- [ ] 一時ファイル削除ロジックと設定値 (`JOB_EXPIRE_MINUTES`) の反映確認

### Progress (自動更新される進捗状況)

#### 完了した主要項目 (Checked Off Big Items) [3]
- 未着手（この計画作成時点では完了項目なし）

#### 現在の作業ステータス [2]
- 計画を策定し、既存コード・ドキュメントの構成と欠落箇所を確認済み。次のステップは ToDo の仕様確認タスクから着手する。

---

## 3. 実行ステップ (Implementation & Execution Steps)

### A. スパイク/リサーチ (Spikes/Research) [4]
pdfcpu や MIME 判定ライブラリの使い方を事前に検証し、導入コストを明確にする。
- [ ] スパイク 1: pdfcpu の `MergeCreateFile` と `api.PageCountFile` を使ったミニマル結合サンプルを `/tmp` 上で試す
- [ ] スパイク 2: `github.com/gabriel-vasile/mimetype` で PDF シグネチャ検証を実施し、許容 MIME の一覧と判定フローをメモ

### B. 実装フェーズ (Feature Implementation) [4]
主要ロジックと HTTP ハンドラーを段階的に組み立てる。
- [ ] 機能 A: `internal/pdf` にサービス構造体と `MergeMultipart` 関数を実装し、順序付け・バリデーション・一時保存・進捗イベントを統合
- [ ] 機能 B: `cmd/api/main.go` に `/api/pdf/merge` エンドポイントを追加し、CSRF/認証ミドルウェア下でサービスを呼び出す
- [ ] 機能 C: 一時ファイルの削除スケジューラとログ出力を整備し、`JOB_EXPIRE_MINUTES` に基づくライフサイクルを実装

### C. ドキュメントおよびテスト (Documentation & Tests) [3, 4]
品質担保とナレッジ共有を行う。
- [ ] 新規機能に対するユニットテスト / 結合テストを追加（正常系・サイズ超過・ページ超過・不正 MIME）
- [ ] `docs/tasks.md` の該当タスク進捗を更新（完了後）
- [ ] 必要に応じて README か内部設計メモに同期処理の実装概要を追記

---

## 4. 決定ログ (Decision Log) [2]

| 日付 | 決定事項 | 理由 |
| :--- | :--- | :--- |
| YYYY/MM/DD | （未決定） | 実装過程で重要な判断が発生したら追記する。 |

---

## 5. 驚きと発見 (Surprises and Discoveries) [2]
まだ実装前のため記入事項なし。作業中に気付きがあれば箇条書きで追記する。

---

## 6. エグゼクティブサマリー (Executive Summary) [3]
作業完了後に Codex が成果と変更点を要約して記入する予定。
