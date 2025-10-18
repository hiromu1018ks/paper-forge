// Package main はAPIサーバーのエントリーポイントです。
package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/yourusername/paper-forge/internal/config"
)

func main() {
	// 設定の読み込み
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Ginのモードを設定
	gin.SetMode(cfg.GinMode)

	// Ginルーターの初期化（デフォルトミドルウェア: Logger, Recovery）
	router := gin.Default()

	// CORSミドルウェアの設定
	corsConfig := cors.DefaultConfig()
	// CORS許可オリジンを設定（カンマ区切りの文字列を配列に変換）
	origins := strings.Split(cfg.CORSAllowedOrigins, ",")
	corsConfig.AllowOrigins = origins
	corsConfig.AllowCredentials = true
	corsConfig.AllowHeaders = []string{
		"Origin",
		"Content-Type",
		"Accept",
		"Authorization",
		"X-CSRF-Token", // CSRF保護用ヘッダー
	}
	router.Use(cors.New(corsConfig))

	// ルーティングの設定
	setupRoutes(router, cfg)

	// サーバーの起動
	addr := ":" + cfg.Port
	log.Printf("Starting API server on %s (mode: %s)", addr, cfg.GinMode)
	if err := router.Run(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// setupRoutes はAPIのルーティングを設定します。
func setupRoutes(router *gin.Engine, cfg *config.Config) {
	// ヘルスチェックエンドポイント
	router.GET("/health", handleHealth)

	// APIグループ
	api := router.Group("/api")
	{
		// 認証エンドポイント（ダミー実装）
		auth := api.Group("/auth")
		{
			auth.POST("/login", handleLogin)
			auth.POST("/logout", handleLogout)
		}

		// TODO: PDF操作エンドポイント（今後実装）
		// pdf := api.Group("/pdf")
		// {
		// 	pdf.POST("/merge", handleMerge)
		// 	pdf.POST("/split", handleSplit)
		// 	pdf.POST("/reorder", handleReorder)
		// 	pdf.POST("/optimize", handleOptimize)
		// }

		// TODO: ジョブ管理エンドポイント（今後実装）
		// jobs := api.Group("/jobs")
		// {
		// 	jobs.GET("/:id", handleGetJob)
		// }
	}
}

// handleHealth はヘルスチェックエンドポイントのハンドラーです。
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": "paper-forge-api",
		"version": "0.1.0",
	})
}

// handleLogin はログインエンドポイントのダミーハンドラーです。
// TODO: 実際の認証ロジックを実装する
func handleLogin(c *gin.Context) {
	// リクエストボディの構造体
	type LoginRequest struct {
		Username string `json:"username" binding:"required"`
		Password string `json:"password" binding:"required"`
	}

	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_INPUT",
			"message": "Invalid request format",
		})
		return
	}

	// TODO: 実際のパスワード検証（bcrypt）を実装
	// TODO: セッションCookieの発行
	// TODO: CSRFトークンの生成と返却

	log.Printf("Login attempt: username=%s", req.Username)

	// ダミーレスポンス（現在は常に成功）
	c.Header("X-CSRF-Token", "dummy-csrf-token")
	c.Status(http.StatusNoContent)
}

// handleLogout はログアウトエンドポイントのダミーハンドラーです。
// TODO: セッション無効化の実装
func handleLogout(c *gin.Context) {
	// TODO: セッションCookieの無効化
	// TODO: CSRFトークンの無効化

	log.Println("Logout request received")

	c.Status(http.StatusNoContent)
}

// 注記:
// このファイルはAPIサーバーの雛形実装です。
// 以下の機能は今後実装予定:
// - bcryptによるパスワード検証
// - セッション管理（gin-contrib/sessions）
// - CSRF保護（gin-csrf または手動実装）
// - レート制限（認証試行回数制限）
// - PDF操作API（internal/pdfパッケージから呼び出し）
// - ジョブ管理API（internal/jobsパッケージから呼び出し）
