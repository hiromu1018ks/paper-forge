/**
 * API関連の共通型定義
 */

// APIエラーレスポンス
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  remainingAttempts?: number;
}

// ジョブ状態
export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobProgress {
  percent: number;
  stage?: string;
  message?: string;
}

// ジョブ情報
export interface JobInfo {
  jobId: string;
  operation: string;
  status: JobStatus;
  progress: JobProgress;
  updatedAt: string;
  downloadUrl?: string;
  meta?: unknown;
  error?: ApiError;
}
