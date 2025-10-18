import { apiClient, toApiError } from './httpClient';

export interface MergeRequest {
  files: File[];
  order?: number[];
}

/**
 * PDF結合API
 * 複数のPDFファイルを結合して1つのPDFを生成
 */
export const mergePdfs = async (request: MergeRequest): Promise<Blob> => {
  try {
    const formData = new FormData();

    // ファイルを追加
    request.files.forEach((file) => {
      formData.append('files[]', file);
    });

    // 順序を指定（省略可能）
    if (request.order) {
      formData.append('order', JSON.stringify(request.order));
    }

    const response = await apiClient.post<Blob>('/pdf/merge', formData, {
      responseType: 'blob',
    });

    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
};
