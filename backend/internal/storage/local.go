// Package storage はストレージ抽象化レイヤーを提供します。
package storage

// TODO: ストレージインターフェースとローカル実装
//
// 実装予定の機能:
// - ローカルファイルシステムへの保存（開発環境用）
// - GCS（Google Cloud Storage）への保存（本番環境用）
// - 署名付きURL生成（GCS）
// - 一時ファイルの自動削除（ジョブ完了後/10分経過後）
//
// ストレージインターフェース:
// type Storage interface {
//     Save(ctx context.Context, path string, data []byte) error
//     Load(ctx context.Context, path string) ([]byte, error)
//     Delete(ctx context.Context, path string) error
//     GenerateSignedURL(ctx context.Context, path string, expiry time.Duration) (string, error)
// }
//
// ローカルストレージ実装:
// - 保存先: /tmp/app/<jobID>/in|out/
// - 自動削除: ジョブ完了時 or 10分経過後
//
// GCSストレージ実装（今後）:
// - 保存先: gs://<bucket>/jobs/<jobID>/in|out/
// - 署名付きURL: PUT用（アップロード）、GET用（ダウンロード）
// - ライフサイクル: 短期自動削除（例: 1時間）
//
// 参考:
// - docs/01_requirements.md: 9. データモデル
// - docs/02_basic_design.md: 内部実装例
