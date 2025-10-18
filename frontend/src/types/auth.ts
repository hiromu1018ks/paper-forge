/**
 * 認証関連の型定義
 */

// ユーザー情報
export interface User {
  username: string;
}

// 認証状態
export interface AuthState {
  isLoggedIn: boolean;
  user: User | null;
  csrfToken: string | null;
  login: (username: string, token: string) => void;
  logout: () => void;
}

// ログインリクエスト
export interface LoginRequest {
  username: string;
  password: string;
}

// ログインレスポンス
export interface LoginResponse {
  // CSRFトークンはヘッダーで返却される想定
}
