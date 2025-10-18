/**
 * 認証関連の型定義
 */

// ユーザー情報
export interface User {
  username: string;
}

// 認証状態
export interface LoginFeedback {
  message: string;
  remainingAttempts?: number;
  retryAfterSeconds?: number;
}

export interface AuthState {
  isLoggedIn: boolean;
  user: User | null;
  csrfToken: string | null;
  loginFeedback: LoginFeedback | null;
  login: (params: { username: string; csrfToken: string }) => void;
  logout: () => void;
  setCsrfToken: (token: string | null) => void;
  recordLoginFailure: (feedback: LoginFeedback) => void;
  clearLoginFeedback: () => void;
}

// ログインリクエスト
export interface LoginRequest {
  username: string;
  password: string;
}

// ログインレスポンス
export interface LoginSuccess {
  csrfToken: string;
  username: string;
}
