import { apiClient, toApiError } from './httpClient';
import { parseContentDispositionFilename, parseJsonFromArrayBuffer } from '@/utils/http';

export type ResultKind = 'pdf' | 'zip';

export interface PdfOperationInlineResult {
  type: 'inline';
  jobId?: string;
  blob: Blob;
  filename: string;
  resultKind: ResultKind;
}

export interface PdfOperationAsyncResult {
  type: 'async';
  jobId: string;
  resultKind: ResultKind;
}

export type PdfOperationResult = PdfOperationInlineResult | PdfOperationAsyncResult;

const decodeAsyncResponse = (buffer: ArrayBuffer): { jobId: string } => {
  const payload = parseJsonFromArrayBuffer<{ jobId: string }>(buffer);
  if (!payload?.jobId) {
    throw new Error('ジョブIDの取得に失敗しました。');
  }
  return payload;
};

interface PostPdfOperationOptions {
  endpoint: string;
  formData: FormData;
  defaultFilename: string;
  resultKind: ResultKind;
}

const postPdfOperation = async ({ endpoint, formData, defaultFilename, resultKind }: PostPdfOperationOptions): Promise<PdfOperationResult> => {
  try {
    const response = await apiClient.post<ArrayBuffer>(endpoint, formData, {
      responseType: 'arraybuffer',
    });

    if (response.status === 202) {
      const payload = decodeAsyncResponse(response.data);
      return { type: 'async', jobId: payload.jobId, resultKind };
    }

    const blob = new Blob([response.data], {
      type: (response.headers['content-type'] as string | undefined) ?? (resultKind === 'zip' ? 'application/zip' : 'application/pdf'),
    });
    const jobIdHeader = response.headers['x-job-id'];
    const jobId = typeof jobIdHeader === 'string' ? jobIdHeader : undefined;
    const filenameHeader = response.headers['content-disposition'] as string | undefined;
    const filename = parseContentDispositionFilename(filenameHeader) ?? defaultFilename;

    return {
      type: 'inline',
      jobId,
      blob,
      filename,
      resultKind,
    };
  } catch (error) {
    throw toApiError(error);
  }
};

export interface MergeRequest {
  files: File[];
  order?: number[];
}

export const mergePdfs = async (request: MergeRequest): Promise<PdfOperationResult> => {
  const formData = new FormData();
  request.files.forEach((file) => {
    formData.append('files[]', file);
  });
  if (request.order && request.order.length > 0) {
    formData.append('order', JSON.stringify(request.order));
  }
  return postPdfOperation({ endpoint: '/pdf/merge', formData, defaultFilename: 'merged.pdf', resultKind: 'pdf' });
};

export interface ReorderRequest {
  file: File;
  order: number[];
}

export const reorderPdf = async (request: ReorderRequest): Promise<PdfOperationResult> => {
  const formData = new FormData();
  formData.append('file', request.file);
  formData.append('order', JSON.stringify(request.order));
  return postPdfOperation({ endpoint: '/pdf/reorder', formData, defaultFilename: 'reordered.pdf', resultKind: 'pdf' });
};

export interface SplitRequest {
  file: File;
  ranges: string;
}

export const splitPdf = async (request: SplitRequest): Promise<PdfOperationResult> => {
  const formData = new FormData();
  formData.append('file', request.file);
  formData.append('ranges', request.ranges);
  return postPdfOperation({ endpoint: '/pdf/split', formData, defaultFilename: 'split.zip', resultKind: 'zip' });
};

export interface OptimizeRequest {
  file: File;
  preset?: OptimizePreset;
}

export const optimizePdf = async (request: OptimizeRequest): Promise<PdfOperationResult> => {
  const formData = new FormData();
  formData.append('file', request.file);
  if (request.preset) {
    formData.append('preset', request.preset);
  }
  return postPdfOperation({ endpoint: '/pdf/optimize', formData, defaultFilename: 'optimized.pdf', resultKind: 'pdf' });
};

// --- メタデータ型 (バックエンドと整合させる) ---

export interface SourceFileMeta {
  name: string;
  size: number;
  pages: number;
}

export interface MergeMeta {
  totalPages: number;
  sources: SourceFileMeta[];
}

export interface ReorderMeta {
  original: SourceFileMeta;
  order: number[];
}

export interface SplitPartMeta {
  filename: string;
  fromPage: number;
  toPage: number;
  pages: number;
  size: number;
}

export interface SplitMeta {
  original: SourceFileMeta;
  ranges: { start: number; end: number }[];
  parts: SplitPartMeta[];
}

export type OptimizePreset = 'standard' | 'aggressive';

export interface OptimizeMeta {
  originalSize: number;
  outputSize: number;
  savedBytes: number;
  savedPercent: number;
  preset: OptimizePreset;
  source: SourceFileMeta;
}
