// Package jobs は非同期ジョブ管理機能を提供します。
package jobs

// TODO: 非同期ジョブワーカーの実装
//
// 実装予定の機能:
// - Asynqを使用した非同期ジョブ処理
// - ジョブ状態の管理（queued, running, done, error）
// - 進捗の計算と更新（0-100%）
// - ジョブ結果の保存（GCS署名URL）
// - ジョブの有効期限管理（デフォルト10分）
//
// 使用ライブラリ:
// - github.com/hibiken/asynq: 非同期ジョブキュー
// - Redis: ジョブ状態の永続化（Cloud Memorystore）
//
// ジョブタイプ:
// - merge: PDF結合
// - split: PDF分割
// - reorder: ページ順入替
// - optimize: PDF圧縮
//
// 進捗計算:
// - load: 0 → 20%
// - process: 20 → 80% (ページ数に応じて分割計測)
// - write: 80 → 100%
//
// 参考:
// - docs/01_requirements.md: 5. 機能要件
// - docs/02_basic_design.md: 8. 進捗の実装詳細
// - docs/04_api_spec.md: GET /jobs/{jobId}
