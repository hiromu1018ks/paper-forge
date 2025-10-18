import { apiClient, toApiError } from './httpClient';
import type { JobInfo } from '@/types/api';
import { parseContentDispositionFilename, parseJsonFromArrayBuffer } from '@/utils/http';

export const getJobStatus = async (jobId: string): Promise<JobInfo> => {
  try {
    const response = await apiClient.get<JobInfo>(`/jobs/${jobId}`);
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
};

export interface JobDownloadResult {
  blob: Blob;
  filename: string;
  contentType: string;
}

export const downloadJobResult = async (jobId: string): Promise<JobDownloadResult> => {
  try {
    const response = await apiClient.get<ArrayBuffer>(`/jobs/${jobId}/download`, {
      responseType: 'arraybuffer',
    });
    const contentType = (response.headers['content-type'] as string | undefined) ?? 'application/octet-stream';
    const disposition = response.headers['content-disposition'] as string | undefined;
    const filename = parseContentDispositionFilename(disposition) ?? `${jobId}-result`;
    const blob = new Blob([response.data], { type: contentType });
    return { blob, filename, contentType };
  } catch (error) {
    throw toApiError(error);
  }
};

export interface AsyncJobEnqueueResponse {
  jobId: string;
}

export const parseAsyncJobResponse = (buffer: ArrayBuffer): AsyncJobEnqueueResponse => {
  const payload = parseJsonFromArrayBuffer<{ jobId: string }>(buffer);
  if (!payload?.jobId) {
    throw new Error('ジョブIDの取得に失敗しました。');
  }
  return payload;
};
