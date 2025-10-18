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

      /**
       * ログイン処理
       * @param username - ユーザー名
       * @param token - CSRFトークン
       */
      login: (username: string, token: string) => {
        set({
          isLoggedIn: true,
          user: { username },
          csrfToken: token,
        });
      },

      /**
       * ログアウト処理
       */
      logout: () => {
        set({
          isLoggedIn: false,
          user: null,
          csrfToken: null,
        });
      },
    }),
    {
      name: 'auth-storage', // localStorage のキー名
    }
  )
);
