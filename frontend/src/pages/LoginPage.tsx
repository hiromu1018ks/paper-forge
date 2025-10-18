/**
 * ログイン画面 (Tailwind CSS版)
 *
 * design.htmlのデザインを踏襲
 */

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { login as loginApi } from '@/api/auth';
import { ApiError } from '@/api/httpClient';
import { useAuthStore } from '@/stores/authStore';
import type { LoginRequest } from '@/types/auth';

type LoginFormInputs = LoginRequest;

export const LoginPage = () => {
  const login = useAuthStore((state) => state.login);
  const loginFeedback = useAuthStore((state) => state.loginFeedback);
  const recordLoginFailure = useAuthStore((state) => state.recordLoginFailure);
  const clearLoginFeedback = useAuthStore((state) => state.clearLoginFeedback);
  const navigate = useNavigate();

  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setFocus,
  } = useForm<LoginFormInputs>({
    defaultValues: {
      username: '',
      password: '',
    },
    mode: 'onBlur',
  });

  // 初期表示でユーザー名入力欄にフォーカスを当てる
  useEffect(() => {
    setFocus('username');
  }, [setFocus]);

  const mutation = useMutation({
    mutationFn: (values: LoginFormInputs) => loginApi(values),
    onSuccess: (result) => {
      login({ username: result.username, csrfToken: result.csrfToken });
      clearLoginFeedback();
      setFormError(null);
      navigate('/app', { replace: true });
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : undefined;
      if (apiError) {
        if (apiError.code === 'INVALID_CREDENTIALS') {
          recordLoginFailure({
            message: apiError.message,
            remainingAttempts: apiError.payload?.remainingAttempts,
          });
        } else if (apiError.code === 'TOO_MANY_ATTEMPTS') {
          recordLoginFailure({
            message: apiError.message,
            retryAfterSeconds: apiError.retryAfterSeconds,
          });
        } else {
          setFormError(apiError.message);
        }
      } else {
        setFormError('予期しないエラーが発生しました。時間を置いて再度お試しください。');
      }
    },
  });

  const onSubmit = handleSubmit((values) => {
    clearLoginFeedback();
    setFormError(null);
    mutation.mutate(values);
  });

  const disableSubmit = mutation.isPending;
  const remainingAttempts = loginFeedback?.remainingAttempts;
  const retryAfterSeconds = loginFeedback?.retryAfterSeconds;

  return (
    <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center mb-4">
            <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-gray-900">Paper Forge</h2>
          <p className="mt-2 text-sm text-gray-600">高機能PDFエディターにログイン</p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                ユーザー名
              </label>
              <input
                id="username"
                type="text"
                {...register('username', {
                  required: 'ユーザー名を入力してください',
                  onChange: () => clearLoginFeedback(),
                })}
                autoComplete="username"
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                disabled={disableSubmit}
              />
              {errors.username && (
                <p className="mt-2 text-sm text-red-600">{errors.username.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                パスワード
              </label>
              <input
                id="password"
                type="password"
                {...register('password', {
                  required: 'パスワードを入力してください',
                  onChange: () => clearLoginFeedback(),
                })}
                autoComplete="current-password"
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                disabled={disableSubmit}
              />
              {errors.password && (
                <p className="mt-2 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>
          </div>

          {loginFeedback && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <p>{loginFeedback.message}</p>
              {typeof remainingAttempts === 'number' && (
                <p className="mt-1 text-sm">残り試行回数: {remainingAttempts} 回</p>
              )}
              {typeof retryAfterSeconds === 'number' && (
                <p className="mt-1 text-sm">
                  再試行まであと約 {Math.ceil(retryAfterSeconds / 60)} 分お待ちください
                </p>
              )}
            </div>
          )}

          {formError && !loginFeedback && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {formError}
            </div>
          )}

          <button
            type="submit"
            disabled={disableSubmit}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{disableSubmit ? 'ログイン中...' : 'ログイン'}</span>
            {disableSubmit && (
              <div className="ml-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
