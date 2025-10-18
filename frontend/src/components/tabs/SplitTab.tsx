import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { splitPdf, type PdfOperationResult, type SplitMeta } from '@/api/pdf';
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
  process: '指定範囲で分割しています',
  write: 'ZIPファイルを書き出しています',
  complete: '処理が完了しました',
};

type ProgressStep = keyof typeof PROGRESS_LABELS;

const isSplitMeta = (meta: unknown): meta is SplitMeta => {
  if (!meta || typeof meta !== 'object') return false;
  return 'parts' in meta && Array.isArray((meta as SplitMeta).parts);
};

const getFriendlyApiMessage = (error: ApiError): string => {
  switch (error.code) {
    case 'INVALID_INPUT':
    case 'INVALID_RANGE':
      return 'ページ範囲の形式が正しくありません。例: 1-3,7,10-';
    case 'LIMIT_EXCEEDED':
      return 'ファイルサイズまたはページ数の上限を超えています。';
    case 'UNSUPPORTED_PDF':
      return '処理できないPDFでした。別のファイルでお試しください。';
    default:
      return error.message || '予期しないエラーが発生しました。時間を置いて再実行してください。';
  }
};

export const SplitTab = () => {
  const [file, setFile] = useState<File | null>(null);
  const [rangesInput, setRangesInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState('split.zip');
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
    setResultFilename('split.zip');
    setShowSuccess(false);
    setProgress(0);
    setProgressStep('load');
    setJobStage(undefined);
    setJobId(null);
    setIsPollingJob(false);
    jobHandledRef.current = false;
  };

  const splitMutation = useMutation({
    mutationFn: async (): Promise<PdfOperationResult> => {
      if (!file) {
        throw new Error('PDFファイルが選択されていません。');
      }
      if (!rangesInput.trim()) {
        throw new Error('分割するページ範囲を入力してください。');
      }
      return splitPdf({
        file,
        ranges: rangesInput.trim(),
      });
    },
    onMutate: () => {
      resetState();
      setErrorMessage(null);
      setIsJobModalOpen(true);
      setProgress(5);
      setProgressStep('load');
    },
    onSuccess: async (result) => {
      if (result.type === 'inline') {
        try {
          const blob = result.blob;
          const filename = result.filename || 'split.zip';
          await saveWorkspaceResult({
            blob,
            filename,
            type: 'zip',
            source: 'split',
            meta: {
              inputFilenames: file ? [file.name] : undefined,
              ranges: rangesInput.split(',').map((item) => item.trim()).filter(Boolean),
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
          if (isSplitMeta(info.meta)) {
            workspaceMeta = {
              inputFilenames: [info.meta.original.name],
              ranges: info.meta.ranges.map((range) => `${range.start}-${range.end}`),
            };
          } else {
            workspaceMeta = {
              inputFilenames: file ? [file.name] : undefined,
              ranges: rangesInput.split(',').map((item) => item.trim()).filter(Boolean),
            };
          }

          await saveWorkspaceResult({
            blob,
            filename,
            type: 'zip',
            source: 'split',
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
        setErrorMessage('ジョブが失敗しました。入力内容を確認してください。');
      }
    }
  }, [jobQuery.data, file, rangesInput, saveWorkspaceResult]);

  useEffect(() => {
    if (!jobQuery.error) return;
    jobHandledRef.current = true;
    setIsPollingJob(false);
    setIsJobModalOpen(false);
    setJobId(null);
    setJobStage(undefined);
    setErrorMessage(jobQuery.error.message);
  }, [jobQuery.error]);

  const canExecute = Boolean(file) && Boolean(rangesInput.trim());
  const progressLabel = jobStageToLabel(jobStage) ?? PROGRESS_LABELS[progressStep];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">PDF分割</h2>
      <p className="text-sm text-gray-600 mb-6">
        PDFを指定したページ範囲で分割し、ZIPファイルとしてダウンロードできます。範囲は「1-3,7,10-」のように入力します。
      </p>

      <div className="space-y-6">
        <div>
          <label htmlFor="split-file-input" className="block text-sm font-medium text-gray-700 mb-2">
            PDFファイル
          </label>
          <input
            type="file"
            id="split-file-input"
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
          <label htmlFor="split-ranges-input" className="block text-sm font-medium text-gray-700 mb-2">
            分割するページ範囲
          </label>
          <textarea
            id="split-ranges-input"
            rows={3}
            value={rangesInput}
            onChange={(event) => setRangesInput(event.target.value)}
            placeholder="例: 1-3,7,10-"
            className="block w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            「-」は範囲指定、「10-」のように末尾を省略すると最終ページまでを指定します。
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => !splitMutation.isPending && !isPollingJob && splitMutation.mutate()}
            disabled={!canExecute || splitMutation.isPending || isPollingJob}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {splitMutation.isPending || isPollingJob ? 'PDFを分割しています...' : 'PDFを分割する'}
          </button>
          {!canExecute && <p className="text-xs text-red-600">PDFファイルと分割範囲を入力してください。</p>}
        </div>
      </div>

      {errorMessage && !isJobModalOpen && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{errorMessage}</div>
      )}

      <ProcessingModal
        isOpen={isJobModalOpen}
        title="PDFを分割しています..."
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
            setRangesInput('');
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
