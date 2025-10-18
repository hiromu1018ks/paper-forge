import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { reorderPdf, type PdfOperationResult, type ReorderMeta } from '@/api/pdf';
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
  process: 'ページ順を変更しています',
  write: '結果を書き出しています',
  complete: '処理が完了しました',
};

type ProgressStep = keyof typeof PROGRESS_LABELS;

const isReorderMeta = (meta: unknown): meta is ReorderMeta => {
  if (!meta || typeof meta !== 'object') return false;
  return 'order' in meta && Array.isArray((meta as ReorderMeta).order);
};

const getFriendlyApiMessage = (error: ApiError): string => {
  switch (error.code) {
    case 'INVALID_INPUT':
      return '入力内容に問題があります。ページ番号の形式を確認してください。';
    case 'LIMIT_EXCEEDED':
      return 'ファイルサイズまたはページ数の上限を超えています。';
    case 'UNSUPPORTED_PDF':
      return '処理できないPDFでした。別のファイルでお試しください。';
    default:
      return error.message || '予期しないエラーが発生しました。時間を置いて再度お試しください。';
  }
};

const parseOrderInput = (input: string): number[] | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const numbers: number[] = [];
  for (const token of tokens) {
    const parsed = Number.parseInt(token, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    numbers.push(parsed - 1);
  }
  return numbers;
};

export const ReorderTab = () => {
  const [file, setFile] = useState<File | null>(null);
  const [orderInput, setOrderInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState('reordered.pdf');
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
    setResultFilename('reordered.pdf');
    setShowSuccess(false);
    setProgress(0);
    setProgressStep('load');
    setJobStage(undefined);
    setJobId(null);
    setIsPollingJob(false);
    jobHandledRef.current = false;
  };

  const reorderMutation = useMutation({
    mutationFn: async (): Promise<PdfOperationResult> => {
      if (!file) {
        throw new Error('PDFファイルが選択されていません。');
      }
      const parsedOrder = parseOrderInput(orderInput);
      if (!parsedOrder || parsedOrder.length === 0) {
        throw new Error('ページ順序を1,2,3のように入力してください。');
      }
      return reorderPdf({
        file,
        order: parsedOrder,
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
          const filename = result.filename || 'reordered.pdf';
          await saveWorkspaceResult({
            blob,
            filename,
            type: 'pdf',
            source: 'reorder',
            meta: {
              inputFilenames: file ? [file.name] : undefined,
              order: parseOrderInput(orderInput)?.map((num) => num + 1),
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
        setErrorMessage('予期しないエラーが発生しました。時間を置いて再度お試しください。');
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
          if (isReorderMeta(info.meta)) {
            workspaceMeta = {
              inputFilenames: [info.meta.original.name],
              order: info.meta.order.map((value) => value + 1),
            };
          } else {
            workspaceMeta = {
              inputFilenames: file ? [file.name] : undefined,
              order: parseOrderInput(orderInput)?.map((value) => value + 1),
            };
          }

          await saveWorkspaceResult({
            blob,
            filename,
            type: 'pdf',
            source: 'reorder',
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
  }, [jobQuery.data, file, orderInput, saveWorkspaceResult]);

  useEffect(() => {
    if (!jobQuery.error) return;
    jobHandledRef.current = true;
    setIsPollingJob(false);
    setIsJobModalOpen(false);
    setJobId(null);
    setJobStage(undefined);
    setErrorMessage(jobQuery.error.message);
  }, [jobQuery.error]);

  const canExecute = Boolean(file) && Boolean(parseOrderInput(orderInput));
  const progressLabel = jobStageToLabel(jobStage) ?? PROGRESS_LABELS[progressStep];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">ページ順入替</h2>
      <p className="text-sm text-gray-600 mb-6">
        単一のPDFファイルに対してページ順を並び替えます。順序は1,2,3のようにカンマ区切りで入力してください（1始まり）。
      </p>

      <div className="space-y-6">
        <div>
          <label htmlFor="reorder-file-input" className="block text-sm font-medium text-gray-700 mb-2">
            PDFファイル
          </label>
          <input
            type="file"
            id="reorder-file-input"
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
          <label htmlFor="reorder-order-input" className="block text-sm font-medium text-gray-700 mb-2">
            新しいページ順序
          </label>
          <textarea
            id="reorder-order-input"
            rows={3}
            value={orderInput}
            onChange={(event) => setOrderInput(event.target.value)}
            placeholder="例: 3,1,2,4"
            className="block w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            ページ番号（1始まり）をカンマまたはスペース区切りで入力してください。ページ数と同じ数を指定する必要があります。
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => !reorderMutation.isPending && !isPollingJob && reorderMutation.mutate()}
            disabled={!canExecute || reorderMutation.isPending || isPollingJob}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reorderMutation.isPending || isPollingJob ? 'ページを入れ替えています...' : 'ページ順を入替える'}
          </button>
          {!canExecute && <p className="text-xs text-red-600">PDFファイルを選択し、ページ順を入力してください。</p>}
        </div>
      </div>

      {errorMessage && !isJobModalOpen && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{errorMessage}</div>
      )}

      <ProcessingModal
        isOpen={isJobModalOpen}
        title="ページ順入替を実行中..."
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
            setOrderInput('');
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
