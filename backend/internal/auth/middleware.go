// Package auth は認証・認可機能を提供します。
package auth

// TODO: 認証ミドルウェアの実装
//
// 実装予定の機能:
// - セッション検証ミドルウェア（/pdf/* エンドポイントの保護）
// - CSRF検証ミドルウェア（状態変更系エンドポイントの保護）
// - レート制限ミドルウェア（API呼び出し回数制限）
//
// 使用ライブラリ:
// - github.com/gin-contrib/sessions: セッション管理
// - github.com/utrack/gin-csrf: CSRF保護（検討中）
//   または手動でダブルサブミット方式を実装
//
// 参考:
// - docs/01_requirements.md: セッション仕様
// - docs/02_basic_design.md: セキュリティ設計
