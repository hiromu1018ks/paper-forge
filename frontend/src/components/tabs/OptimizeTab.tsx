import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { optimizePdf, type OptimizeMeta, type OptimizePreset, type PdfOperationResult } from '@/api/pdf';
import { downloadJobResult } from '@/api/jobs';
import { ApiError } from '@/api/httpClient';
import { ErrorModal } from '@/components/modals/ErrorModal';
import { ProcessingModal } from '@/components/modals/ProcessingModal';
import { SuccessModal } from '@/components/modals/SuccessModal';
import { useJobPolling } from '@/hooks/useJobPolling';
import { jobStageToLabel } from '@/utils/jobProgress';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceResultMeta } from '@/types/workspace';

const PROGRESS_LABELS = {
  load: 'ファイルを読み込んでいます',
  process: 'Ghostscriptで圧縮しています',
  write: '最適化済みPDFを書き出しています',
  complete: '処理が完了しました',
};

type ProgressStep = keyof typeof PROGRESS_LABELS;

const isOptimizeMeta = (meta: unknown): meta is OptimizeMeta => {
  if (!meta || typeof meta !== 'object') return false;
  return 'outputSize' in meta && 'preset' in meta;
};

const getFriendlyApiMessage = (error: ApiError): string => {
  switch (error.code) {
    case 'INVALID_INPUT':
      return '入力内容に問題があります。プリセットの値を確認してください。';
    case 'LIMIT_EXCEEDED':
      return 'ファイルサイズまたはページ数の上限を超えています。';
    case 'UNSUPPORTED_PDF':
      return '圧縮できないPDFでした。別のファイルでお試しください。';
    default:
      return error.message || '予期しないエラーが発生しました。時間を置いて再実行してください。';
  }
};

export const OptimizeTab = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<OptimizePreset>('standard');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState('optimized.pdf');
  const [showSuccess, setShowSuccess] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState<ProgressStep>('load');
  const [jobId, setJobId] = useState<string | null>(null);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobStage, setJobStage] = useState<string | undefined>();
  const [isPollingJob, setIsPollingJob] = useState(false);

  const navigate = useNavigate();
  const saveWorkspaceResult = useWorkspaceStore((state) => state.saveResult);
  const jobHandledRef = useRef(false);

  const jobQuery = useJobPolling({ jobId, enabled: isPollingJob });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) {
      if (!selected.name.toLowerCase().endsWith('.pdf')) {
        setErrorMessage('PDFファイルのみ選択できます');
        setFile(null);
      } else {
        setErrorMessage(null);
        setFile(selected);
      }
    }
    event.target.value = '';
  };

  const resetState = () => {
    setResultBlob(null);
    setResultFilename('optimized.pdf');
    setShowSuccess(false);
    setProgress(0);
    setProgressStep('load');
    setJobStage(undefined);
    setJobId(null);
    setIsPollingJob(false);
    jobHandledRef.current = false;
  };

  const optimizeMutation = useMutation({
    mutationFn: async (): Promise<PdfOperationResult> => {
      if (!file) {
        throw new Error('PDFファイルが選択されていません。');
      }
      return optimizePdf({
        file,
        preset,
      });
    },
    onMutate: () => {
      resetState();
      setErrorMessage(null);
      setIsJobModalOpen(true);
      setProgress(10);
      setProgressStep('load');
    },
    onSuccess: async (result) => {
      if (result.type === 'inline') {
        try {
          const blob = result.blob;
          const filename = result.filename || 'optimized.pdf';
          const savedBytes = file ? file.size - blob.size : undefined;
          const savedPercent = file && file.size > 0 ? ((file.size - blob.size) / file.size) * 100 : undefined;
          await saveWorkspaceResult({
            blob,
            filename,
            type: 'pdf',
            source: 'optimize',
            meta: {
              inputFilenames: file ? [file.name] : undefined,
              savedBytes,
              savedPercent,
              preset,
            },
          });
          setResultBlob(blob);
          setResultFilename(filename);
          setProgress(100);
          setProgressStep('complete');
          setShowSuccess(true);
        } catch (storageError) {
          console.error(storageError);
          setErrorMessage('結果の保存に失敗しました。もう一度お試しください。');
        } finally {
          setIsJobModalOpen(false);
        }
        return;
      }

      jobHandledRef.current = false;
      setJobId(result.jobId);
      setIsPollingJob(true);
      setJobStage('queued');
      setProgress(15);
      setProgressStep('load');
    },
    onError: (error) => {
      setIsJobModalOpen(false);
      setIsPollingJob(false);
      setProgress(0);
      if (error instanceof ApiError) {
        setErrorMessage(getFriendlyApiMessage(error));
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('予期しないエラーが発生しました。時間を置いて再実行してください。');
      }
    },
  });

  useEffect(() => {
    if (!jobQuery.data || jobHandledRef.current) return;
    const info = jobQuery.data;
    if (info.progress.percent !== undefined) {
      setProgress((prev) => Math.max(prev, info.progress.percent));
    }
    if (info.progress.stage) {
      setJobStage(info.progress.stage);
    }
    if (info.status === 'running') {
      setProgressStep('process');
    }

    if (info.status === 'done') {
      jobHandledRef.current = true;
      const finalize = async () => {
        try {
          setProgressStep('write');
          const { blob, filename } = await downloadJobResult(info.jobId);
          let workspaceMeta: WorkspaceResultMeta | undefined;
          if (isOptimizeMeta(info.meta)) {
            workspaceMeta = {
              inputFilenames: [info.meta.source.name],
              savedBytes: info.meta.savedBytes,
              savedPercent: info.meta.savedPercent,
              preset: info.meta.preset,
            };
          } else {
            const savedBytes = file ? file.size - blob.size : undefined;
            const savedPercent = file && file.size > 0 ? ((file.size - blob.size) / file.size) * 100 : undefined;
            workspaceMeta = {
              inputFilenames: file ? [file.name] : undefined,
              savedBytes,
              savedPercent,
              preset,
            };
          }

          await saveWorkspaceResult({
            blob,
            filename,
            type: 'pdf',
            source: 'optimize',
            meta: workspaceMeta,
          });
          setResultBlob(blob);
          setResultFilename(filename);
          setProgress(100);
          setProgressStep('complete');
          setShowSuccess(true);
        } catch (downloadError) {
          console.error(downloadError);
          if (downloadError instanceof ApiError) {
            setErrorMessage(getFriendlyApiMessage(downloadError));
          } else if (downloadError instanceof Error) {
            setErrorMessage(downloadError.message);
          } else {
            setErrorMessage('ジョブ結果の取得に失敗しました。');
          }
        } finally {
          setIsPollingJob(false);
          setIsJobModalOpen(false);
          setJobId(null);
          setJobStage(undefined);
        }
      };
      finalize();
    } else if (info.status === 'error') {
      jobHandledRef.current = true;
      setIsPollingJob(false);
      setIsJobModalOpen(false);
      setJobId(null);
      setJobStage(undefined);
      if (info.error) {
        setErrorMessage(info.error.message);
      } else {
        setErrorMessage('ジョブが失敗しました。別のファイルでお試しください。');
      }
    }
  }, [jobQuery.data, file, preset, saveWorkspaceResult]);

  useEffect(() => {
    if (!jobQuery.error) return;
    jobHandledRef.current = true;
    setIsPollingJob(false);
    setIsJobModalOpen(false);
    setJobId(null);
    setJobStage(undefined);
    setErrorMessage(jobQuery.error.message);
  }, [jobQuery.error]);

  const canExecute = Boolean(file);
  const progressLabel = jobStageToLabel(jobStage) ?? PROGRESS_LABELS[progressStep];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">PDF圧縮</h2>
      <p className="text-sm text-gray-600 mb-6">
        Ghostscript を用いてPDFを最適化します。画質と圧縮率のバランスに応じてプリセットを選択してください。
      </p>

      <div className="space-y-6">
        <div>
          <label htmlFor="optimize-file-input" className="block text-sm font-medium text-gray-700 mb-2">
            PDFファイル
          </label>
          <input
            type="file"
            id="optimize-file-input"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {file && (
            <p className="text-xs text-gray-500 mt-2">
              選択中: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">圧縮プリセット</span>
          <div className="space-y-2">
            <label className="flex items-center text-sm text-gray-700">
              <input
                type="radio"
                className="mr-2"
                name="optimize-preset"
                value="standard"
                checked={preset === 'standard'}
                onChange={() => setPreset('standard')}
              />
              standard（推奨）：画質とサイズのバランスが良い一般的な圧縮
            </label>
            <label className="flex items-center text-sm text-gray-700">
              <input
                type="radio"
                className="mr-2"
                name="optimize-preset"
                value="aggressive"
                checked={preset === 'aggressive'}
                onChange={() => setPreset('aggressive')}
              />
              aggressive：サイズを優先して大きく削減（画質が低下する場合があります）
            </label>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => !optimizeMutation.isPending && !isPollingJob && optimizeMutation.mutate()}
            disabled={!canExecute || optimizeMutation.isPending || isPollingJob}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {optimizeMutation.isPending || isPollingJob ? 'PDFを圧縮しています...' : 'PDFを圧縮する'}
          </button>
          {!canExecute && <p className="text-xs text-red-600">PDFファイルを選択してください。</p>}
        </div>
      </div>

      {errorMessage && !isJobModalOpen && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{errorMessage}</div>
      )}

      <ProcessingModal
        isOpen={isJobModalOpen}
        title="PDFを圧縮しています..."
        message="処理には数秒かかる場合があります。画面を閉じずにお待ちください。"
        progress={progress}
        stepLabel={progressLabel}
      />

      {resultBlob && (
        <SuccessModal
          isOpen={showSuccess}
          filename={resultFilename}
          blob={resultBlob}
          onClose={() => setShowSuccess(false)}
          onNewProcess={() => {
            setFile(null);
            resetState();
          }}
          onViewWorkspace={() => {
            setShowSuccess(false);
            navigate('/workspace');
          }}
        />
      )}

      <ErrorModal isOpen={!!errorMessage && !isJobModalOpen} message={errorMessage ?? ''} onClose={() => setErrorMessage(null)} />
    </div>
  );
};
