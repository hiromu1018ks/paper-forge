// Package auth は認証・認可機能を提供します。
package auth

// TODO: 認証ハンドラーの実装
//
// 実装予定の機能:
// - ログイン処理（bcryptでのパスワード検証）
// - ログアウト処理（セッション無効化）
// - セッションCookieの発行（Secure, HttpOnly, SameSite=Strict）
// - CSRFトークンの生成と検証（ダブルサブミット方式）
// - レート制限（ログイン試行回数制限: 5回/15分/IP）
//
// 参考:
// - docs/01_requirements.md: 認証方式の要件
// - docs/02_basic_design.md: セキュリティ設計
// - docs/04_api_spec.md: /auth/login, /auth/logout の仕様
