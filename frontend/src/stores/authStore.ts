/**
 * 認証状態管理ストア (Zustand)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthState } from '@/types/auth';

/**
 * 認証ストア
 * - ログイン状態、ユーザー情報、CSRFトークンを管理
 * - localStorage に永続化（セッション維持）
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      user: null,
      csrfToken: null,
      loginFeedback: null,

      /**
       * ログイン成功時にセッション情報を保存
       */
      login: ({ username, csrfToken }) => {
        set({
          isLoggedIn: true,
          user: { username },
          csrfToken,
          loginFeedback: null,
        });
      },

      /**
       * セッション終了時の状態リセット
       */
      logout: () => {
        set({
          isLoggedIn: false,
          user: null,
          csrfToken: null,
          loginFeedback: null,
        });
      },

      /**
       * サーバーから受け取った最新の CSRF トークンを保存
       */
      setCsrfToken: (token) => {
        set({ csrfToken: token });
      },

      /**
       * ログイン失敗時のエラーメッセージ・残り回数を保持
       */
      recordLoginFailure: (feedback) => {
        set({
          loginFeedback: feedback,
          isLoggedIn: false,
          user: null,
          csrfToken: null,
        });
      },

      /**
       * 画面表示後にエラーメッセージをクリア
       */
      clearLoginFeedback: () => {
        set({ loginFeedback: null });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        isLoggedIn: state.isLoggedIn,
        user: state.user,
        csrfToken: state.csrfToken,
      }),
    }
  )
);
