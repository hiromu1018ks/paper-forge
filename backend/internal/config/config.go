// Package config は環境変数から設定を読み込み、アプリケーション全体で使用する設定を提供します。
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/joho/godotenv"
)

// Config はアプリケーションの設定を保持する構造体です。
type Config struct {
	// アプリケーション設定
	AppUsername     string // ログイン用ユーザー名
	AppPasswordHash string // bcryptでハッシュ化されたパスワード
	SessionSecret   string // セッション署名用の秘密鍵

	// サーバー設定
	Port    string // APIサーバーのポート番号
	GinMode string // Ginの実行モード (debug, release, test)

	// CORS設定
	CORSAllowedOrigins string // CORS許可オリジン（カンマ区切り）

	// ファイル制限
	MaxFileSize      int64 // 単一ファイルの最大サイズ（バイト）
	MaxPages         int   // 単一ファイルの最大ページ数
	JobExpireMinutes int   // ジョブの有効期限（分）

	// ジョブ/キュー設定
	QueueRedisURL       string // Asynq用Redis接続URL
	AsyncThresholdBytes int64  // 同期処理から非同期へ切り替えるサイズ閾値
	AsyncThresholdPages int    // 同期処理から非同期へ切り替えるページ閾値
	JobResultBaseURL    string // 結果ファイル取得用のベースURL（署名URL等を生成する場合に使用）

	// PDF処理設定
	GhostscriptPath string // Ghostscript実行ファイルのパス

	// GCP設定（本番環境用）
	GCPProject     string // GCPプロジェクトID
	GCSBucket      string // Google Cloud Storageバケット名
	ServiceAccount string // サービスアカウント
}

// Load は環境変数から設定を読み込みます。
// .env.local ファイルが存在する場合はそこから読み込みます。
func Load() (*Config, error) {
	// .env.local ファイルを読み込む（存在しない場合はスキップ）
	loadEnvFile()

	config := &Config{
		// アプリケーション設定
		AppUsername:     getEnv("APP_USERNAME", ""),
		AppPasswordHash: getEnv("APP_PASSWORD_HASH", ""),
		SessionSecret:   getEnv("SESSION_SECRET", ""),

		// サーバー設定
		Port:    getEnv("PORT", "8080"),
		GinMode: getEnv("GIN_MODE", "debug"),

		// CORS設定
		CORSAllowedOrigins: getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:5173"),

		// ファイル制限
		MaxFileSize:      getEnvAsInt64("MAX_FILE_SIZE", 104857600), // 100MB
		MaxPages:         getEnvAsInt("MAX_PAGES", 200),
		JobExpireMinutes: getEnvAsInt("JOB_EXPIRE_MINUTES", 10),

		// ジョブ/キュー設定
		QueueRedisURL:       getEnv("QUEUE_REDIS_URL", "redis://127.0.0.1:6379/0"),
		AsyncThresholdBytes: getEnvAsInt64("ASYNC_THRESHOLD_BYTES", 50*1024*1024), // 50MB
		AsyncThresholdPages: getEnvAsInt("ASYNC_THRESHOLD_PAGES", 120),
		JobResultBaseURL:    getEnv("JOB_RESULT_BASE_URL", ""),

		// PDF処理設定
		GhostscriptPath: getEnv("GHOSTSCRIPT_PATH", "gs"),

		// GCP設定
		GCPProject:     getEnv("GCP_PROJECT", ""),
		GCSBucket:      getEnv("GCS_BUCKET", ""),
		ServiceAccount: getEnv("SERVICE_ACCOUNT", ""),
	}

	// 必須設定のバリデーション
	if err := config.Validate(); err != nil {
		return nil, err
	}

	return config, nil
}

func loadEnvFile() {
	if err := godotenv.Load(".env.local"); err == nil {
		return
	}

	cwd, err := os.Getwd()
	if err != nil {
		return
	}

	parent := filepath.Dir(cwd)
	if parent == "" || parent == cwd {
		return
	}

	_ = godotenv.Load(filepath.Join(parent, ".env.local"))
}

// Validate は設定の妥当性を検証します。
func (c *Config) Validate() error {
	// ローカル開発では認証設定は任意
	// 本番環境では厳格にチェックする想定
	if c.GinMode == "release" {
		if c.AppUsername == "" {
			return fmt.Errorf("APP_USERNAME is required in release mode")
		}
		if c.AppPasswordHash == "" {
			return fmt.Errorf("APP_PASSWORD_HASH is required in release mode")
		}
		if c.SessionSecret == "" {
			return fmt.Errorf("SESSION_SECRET is required in release mode")
		}
		if c.QueueRedisURL == "" {
			return fmt.Errorf("QUEUE_REDIS_URL is required in release mode")
		}
		if c.GhostscriptPath == "" {
			return fmt.Errorf("GHOSTSCRIPT_PATH is required in release mode")
		}
	}

	return nil
}

// getEnv は環境変数を取得し、存在しない場合はデフォルト値を返します。
func getEnv(key string, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

// getEnvAsInt は環境変数を整数として取得します。
func getEnvAsInt(key string, defaultValue int) int {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(valueStr)
	if err != nil {
		return defaultValue
	}
	return value
}

// getEnvAsInt64 は環境変数を64ビット整数として取得します。
func getEnvAsInt64(key string, defaultValue int64) int64 {
	valueStr := os.Getenv(key)
	if valueStr == "" {
		return defaultValue
	}
	value, err := strconv.ParseInt(valueStr, 10, 64)
	if err != nil {
		return defaultValue
	}
	return value
}
