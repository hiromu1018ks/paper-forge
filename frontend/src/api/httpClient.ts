import axios, { AxiosError, AxiosHeaders } from 'axios';

import { useAuthStore } from '@/stores/authStore';
import { arrayBufferToString } from '@/utils/http';

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase();
  if (method && method !== 'GET' && method !== 'HEAD') {
    const token = useAuthStore.getState().csrfToken;
    if (token) {
      if (config.headers instanceof AxiosHeaders) {
        config.headers.set('X-CSRF-Token', token);
      } else {
        const headers = AxiosHeaders.from(config.headers ?? {});
        headers.set('X-CSRF-Token', token);
        config.headers = headers;
      }
    }
  }
  return config;
});

// 401エラー時の自動ログアウト
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      // ログイン画面へのリクエストの場合はログアウト処理をスキップ
      const isLoginRequest = error.config?.url?.includes('/auth/login');
      if (!isLoginRequest) {
        // 認証エラーの場合は自動的にログアウト
        useAuthStore.getState().logout();
      }
    }
    return Promise.reject(error);
  }
);

export interface ApiErrorPayload {
  code: string;
  message: string;
  remainingAttempts?: number;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;

  readonly code: string;

  readonly payload?: ApiErrorPayload;

  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, code: string, payload?: ApiErrorPayload, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const parseRetryAfterHeader = (headerValue: unknown): number | undefined => {
  if (!headerValue) {
    return undefined;
  }

  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== 'string') {
    return undefined;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const parsedDate = Date.parse(raw);
  if (Number.isNaN(parsedDate)) {
    return undefined;
  }

  const diffMilliseconds = parsedDate - Date.now();
  if (!Number.isFinite(diffMilliseconds)) {
    return undefined;
  }

  const diffSeconds = Math.ceil(diffMilliseconds / 1000);
  return diffSeconds >= 0 ? diffSeconds : 0;
};

const normalizeResponseData = (data: unknown): ApiErrorPayload | undefined => {
  if (!data) return undefined;
  if (data instanceof ArrayBuffer) {
    try {
      const text = arrayBufferToString(data);
      return text ? (JSON.parse(text) as ApiErrorPayload) : undefined;
    } catch (parseError) {
      console.warn('Failed to parse array buffer response as JSON:', parseError);
      return undefined;
    }
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    // Blob は同期的に扱えないためメッセージのみ返す
    return undefined;
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as ApiErrorPayload;
    } catch {
      return { code: 'UNKNOWN_ERROR', message: data };
    }
  }
  return data as ApiErrorPayload | undefined;
};

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) {
    return error;
  }
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorPayload>;
    const status = axiosError.response?.status ?? 0;
    const payload = normalizeResponseData(axiosError.response?.data);
    const message = payload?.message ?? axiosError.message;
    const code = payload?.code ?? 'UNKNOWN_ERROR';
    const retryAfterHeader = axiosError.response?.headers?.['retry-after'];
    const retryAfterSeconds = parseRetryAfterHeader(retryAfterHeader);
    return new ApiError(message, status, code, payload, retryAfterSeconds);
  }
  return new ApiError('予期しないエラーが発生しました', 0, 'UNKNOWN_ERROR');
};
