// Package main はAPIサーバーのエントリーポイントです。
package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"

	"github.com/yourusername/paper-forge/internal/auth"
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

	// セッションストアの設定（クッキー署名鍵は必須）
	store := cookie.NewStore([]byte(cfg.SessionSecret))
	store.Options(sessions.Options{
		Path:     "/",
		MaxAge:   auth.SessionMaxAgeSeconds(),
		HttpOnly: true,
		Secure:   cfg.GinMode == gin.ReleaseMode,
		SameSite: http.SameSiteStrictMode,
	})
	router.Use(sessions.Sessions(auth.SessionCookieName, store))

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
	// フロントエンドがレスポンスヘッダーから CSRF トークンを読み取れるように公開
	corsConfig.ExposeHeaders = []string{"X-CSRF-Token"}
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

// handleHealth はヘルスチェックエンドポイントのハンドラーです。
func handleHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"service": "paper-forge-api",
		"version": "0.1.0",
	})
}

// setupRoutes は API グループと認証周りの配線を行います。
func setupRoutes(router *gin.Engine, cfg *config.Config) {
	// まずは誰でも叩けるヘルスチェックを登録
	router.GET("/health", handleHealth)

	authManager := auth.NewManager(cfg)

	api := router.Group("/api")
	{
		authRoutes := api.Group("/auth")
		{
			// ログイン時はセッション未生成なので CSRF 検証は不要
			authRoutes.POST("/login", authManager.Login)
			authRoutes.POST("/logout",
				authManager.RequireLogin(),
				authManager.VerifyCSRF(),
				authManager.Logout,
			)
		}

		// 今後追加する API はここにぶら下げる
		protected := api.Group("")
		protected.Use(authManager.RequireLogin(), authManager.VerifyCSRF())
		{
			// TODO: /api/pdf/* 系の実装を追加する
		}
	}
}
