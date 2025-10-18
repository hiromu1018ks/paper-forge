import { apiClient, ApiError, toApiError } from './httpClient';

import type { LoginRequest, LoginSuccess } from '@/types/auth';

export const login = async (payload: LoginRequest): Promise<LoginSuccess> => {
  try {
    const response = await apiClient.post<void>('/auth/login', payload);
    const headerToken = response.headers['x-csrf-token'];
    const csrfToken = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    if (!csrfToken) {
      throw new ApiError('CSRF トークンの取得に失敗しました', response.status ?? 204, 'CSRF_MISSING');
    }
    return {
      csrfToken,
      username: payload.username,
    };
  } catch (error) {
    throw toApiError(error);
  }
};

export const logout = async (): Promise<void> => {
  try {
    await apiClient.post('/auth/logout');
  } catch (error) {
    throw toApiError(error);
  }
};
