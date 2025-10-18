/**
 * API関連の共通型定義
 */

// APIエラーレスポンス
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ジョブ状態
export type JobStatus = 'queued' | 'running' | 'done' | 'error';

// ジョブ情報
export interface JobInfo {
  jobId: string;
  status: JobStatus;
  progress: number; // 0-100
  downloadUrl?: string;
  error?: ApiError;
}
