/**
 * PDF結合タブ (SortableJS + Tailwind CSS)
 *
 * - ファイル選択とドラッグ&ドロップによる並べ替え
 * - 同期/非同期処理を自動判定し、非同期時はジョブ進捗をポーリング
 * - 成功時はワークスペースストアへ結果を保存し、ワークスペースページへの導線を表示
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Sortable from 'sortablejs';

import { mergePdfs, type MergeMeta, type PdfOperationResult } from '@/api/pdf';
import { downloadJobResult } from '@/api/jobs';
import { ApiError } from '@/api/httpClient';
import { ErrorModal } from '@/components/modals/ErrorModal';
import { ProcessingModal } from '@/components/modals/ProcessingModal';
import { SuccessModal } from '@/components/modals/SuccessModal';
import { useJobPolling } from '@/hooks/useJobPolling';
import { jobStageToLabel } from '@/utils/jobProgress';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceResultMeta } from '@/types/workspace';

interface UploadedFile {
  id: string;
  file: File;
  error?: string;
}

type ProgressStep = 'idle' | 'load' | 'process' | 'write' | 'complete';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_TOTAL_SIZE = 300 * 1024 * 1024; // 300MB
const MAX_FILES = 20;
const PROGRESS_LABELS: Record<ProgressStep, string> = {
  idle: '',
  load: 'ファイルを読み込んでいます',
  process: 'PDFを結合しています',
  write: '結果ファイルを書き出しています',
  complete: '処理が完了しました',
};

const getFriendlyApiMessage = (error: ApiError): string => {
  switch (error.code) {
    case 'INVALID_INPUT':
      return '入力内容に問題があります。ファイル内容や順序を確認してください。';
    case 'LIMIT_EXCEEDED':
      return '容量またはページ数の上限を超えています。ファイルを減らすかサイズを調整してください。';
    case 'UNSUPPORTED_PDF':
      return '処理できないPDFでした。別のファイルでお試しください。';
    case 'TOO_MANY_ATTEMPTS':
      return error.message;
    default:
      return error.message || '予期しないエラーが発生しました。時間を置いて再度お試しください。';
  }
};

const generateOutputFilename = (files: UploadedFile[]): string => {
  const timestamp = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  const base =
    files.length === 1
      ? files[0].file.name.replace(/\.pdf$/i, '')
      : `merged-${files.length}files`;
  return `${base}-${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(
    timestamp.getHours()
  )}${pad(timestamp.getMinutes())}${pad(timestamp.getSeconds())}.pdf`;
};

const isMergeMeta = (meta: unknown): meta is MergeMeta => {
  if (!meta || typeof meta !== 'object') return false;
  return 'sources' in meta && Array.isArray((meta as MergeMeta).sources);
};

export const MergeTab = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState<string>('merged.pdf');
  const [showSuccess, setShowSuccess] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStep, setProgressStep] = useState<ProgressStep>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStage, setJobStage] = useState<string | undefined>(undefined);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [isPollingJob, setIsPollingJob] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sortableRef = useRef<Sortable | null>(null);
  const lastSubmittedFilesRef = useRef<UploadedFile[]>([]);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobHandledRef = useRef(false);

  const navigate = useNavigate();
  const saveWorkspaceResult = useWorkspaceStore((state) => state.saveResult);

  const jobQuery = useJobPolling({ jobId, enabled: isPollingJob });

  const validateFile = (file: File): string | null => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return 'PDFファイルのみアップロードできます';
    }
    if (file.type !== 'application/pdf') {
      return 'PDFファイルではありません';
    }
    if (file.size > MAX_FILE_SIZE) {
      return `ファイルサイズが100MBを超えています（${(file.size / 1024 / 1024).toFixed(1)}MB）`;
    }
    return null;
  };

  const appendFiles = (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return;

    setErrorMessage(null);

    if (files.length + selectedFiles.length > MAX_FILES) {
      setErrorMessage(`ファイル数は${MAX_FILES}個以下にしてください`);
      return;
    }

    const newFiles: UploadedFile[] = selectedFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      error: validateFile(file) ?? undefined,
    }));

    const combined = [...files, ...newFiles];
    setFiles(combined);

    const totalSize = combined.reduce((sum, f) => sum + f.file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      setErrorMessage(`合計サイズが300MBを超えています（${(totalSize / 1024 / 1024).toFixed(1)}MB）`);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    appendFiles(selectedFiles);
    event.target.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    const dropped = Array.from(event.dataTransfer.files).filter((file) => file.type === 'application/pdf');
    appendFiles(dropped);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
    setErrorMessage(null);
  };

  useEffect(() => {
    if (containerRef.current && files.length > 0) {
      if (sortableRef.current) {
        sortableRef.current.destroy();
      }

      sortableRef.current = Sortable.create(containerRef.current, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        handle: '.drag-handle',
        onEnd: (evt) => {
          const { oldIndex, newIndex } = evt;
          if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
          setFiles((prevFiles) => {
            const nextFiles = [...prevFiles];
            const [movedFile] = nextFiles.splice(oldIndex, 1);
            nextFiles.splice(newIndex, 0, movedFile);
            return nextFiles;
          });
        },
      });
    }

    return () => {
      if (sortableRef.current) {
        sortableRef.current.destroy();
        sortableRef.current = null;
      }
    };
  }, [files.length]);

  const resetState = () => {
    setResultBlob(null);
    setResultFilename('merged.pdf');
    setShowSuccess(false);
    setProgress(0);
    setProgressStep('idle');
    setJobStage(undefined);
    setJobId(null);
    setIsPollingJob(false);
    jobHandledRef.current = false;
  };

  const mergeMutation = useMutation({
    mutationFn: async (): Promise<PdfOperationResult> => {
      const validFiles = files.filter((file) => !file.error);
      if (validFiles.length === 0) {
        throw new Error('有効なPDFファイルが選択されていません。');
      }
      lastSubmittedFilesRef.current = validFiles;
      return mergePdfs({
        files: validFiles.map((item) => item.file),
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
        setProgress(95);
        setProgressStep('write');
        try {
          const submittedFiles = lastSubmittedFilesRef.current;
          const outputFilename = result.filename || generateOutputFilename(submittedFiles);
          await saveWorkspaceResult({
            blob: result.blob,
            filename: outputFilename,
            type: 'pdf',
            source: 'merge',
            meta: {
              inputFilenames: submittedFiles.map((item) => item.file.name),
            },
          });
          setResultBlob(result.blob);
          setResultFilename(outputFilename);
          setProgress(100);
          setProgressStep('complete');
          setShowSuccess(true);
        } catch (storageError) {
          console.error('ワークスペースへの保存に失敗しました:', storageError);
          setErrorMessage('結果の保存に失敗しました。もう一度お試しください。');
        } finally {
          setIsJobModalOpen(false);
        }
        return;
      }

      // 非同期ジョブへ切り替え
      jobHandledRef.current = false;
      setJobId(result.jobId);
      setIsPollingJob(true);
      setJobStage('queued');
      setProgress(10);
      setProgressStep('load');
    },
    onError: (error: unknown) => {
      setProgress(0);
      setProgressStep('idle');
      setIsJobModalOpen(false);
      if (error instanceof ApiError) {
        setErrorMessage(getFriendlyApiMessage(error));
        return;
      }
      if (error instanceof Error) {
        setErrorMessage(error.message);
        return;
      }
      setErrorMessage('予期しないエラーが発生しました。時間を置いて再実行してください。');
    },
  });

  useEffect(() => {
    if (isJobModalOpen && mergeMutation.isPending && !isPollingJob) {
      const stepTargets: { step: ProgressStep; target: number }[] = [
        { step: 'load', target: 20 },
        { step: 'process', target: 45 },
      ];
      let currentIndex = 0;

      progressIntervalRef.current = setInterval(() => {
        setProgress((prev) => {
          const currentTarget = stepTargets[currentIndex]?.target ?? 50;
          if (prev < currentTarget) {
            return Math.min(prev + 3, currentTarget);
          }
          if (currentIndex < stepTargets.length - 1) {
            currentIndex += 1;
            setProgressStep(stepTargets[currentIndex].step);
          }
          return prev;
        });
      }, 400);
    } else {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isJobModalOpen, mergeMutation.isPending, isPollingJob]);

  useEffect(() => {
    if (!jobQuery.data || jobHandledRef.current) {
      return;
    }
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
          const submittedFiles = lastSubmittedFilesRef.current;
          let workspaceMeta: WorkspaceResultMeta | undefined;
          if (isMergeMeta(info.meta)) {
            workspaceMeta = {
              inputFilenames: info.meta.sources.map((source) => source.name),
              pageCount: info.meta.totalPages,
            };
          } else {
            workspaceMeta = {
              inputFilenames: submittedFiles.map((item) => item.file.name),
            };
          }

          await saveWorkspaceResult({
            blob,
            filename,
            type: 'pdf',
            source: 'merge',
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
            setErrorMessage('ジョブ結果の取得中にエラーが発生しました。');
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
        setErrorMessage('ジョブが失敗しました。詳細を確認して再度お試しください。');
      }
    }
  }, [jobQuery.data, saveWorkspaceResult]);

  useEffect(() => {
    if (!jobQuery.error) return;
    jobHandledRef.current = true;
    setIsPollingJob(false);
    setIsJobModalOpen(false);
    setJobId(null);
    setJobStage(undefined);
    setErrorMessage(jobQuery.error.message);
  }, [jobQuery.error]);

  const handleReset = () => {
    resetState();
    setFiles([]);
    setErrorMessage(null);
  };

  const validFiles = useMemo(() => files.filter((file) => !file.error), [files]);
  const hasErrors = files.some((file) => file.error);
  const totalSize = files.reduce((sum, file) => sum + file.file.size, 0);
  const canExecute = validFiles.length >= 2 && !hasErrors && totalSize <= MAX_TOTAL_SIZE;

  const executeMerge = () => {
    if (!canExecute || mergeMutation.isPending || isPollingJob) return;
    mergeMutation.mutate();
  };

  const progressLabel = jobStageToLabel(jobStage) ?? PROGRESS_LABELS[progressStep];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">PDF結合</h2>
      <p className="text-sm text-gray-600 mb-6">
        複数のPDFファイルを1つに結合します。ドラッグ&ドロップで順序を変更できます。
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          event.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove('drag-over');
        }}
        onDrop={handleDrop}
        onClick={() => document.getElementById('merge-file-input')?.click()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
      >
        <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
          <path
            d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3-3m-3 3l3 3m-3-3H21m12 0v-8a4 4 0 00-4-4h-5m0 0V8a4 4 0 014-4h4m-4 4v4m-4 0h4"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="mt-2 text-sm text-gray-600">
          <span className="font-medium">クリックしてファイルを選択</span> または ドラッグ&ドロップ
        </p>
        <p className="text-xs text-gray-500 mt-1">PDF形式のみ（最大20ファイル、各100MB以下）</p>
        <input
          type="file"
          id="merge-file-input"
          multiple
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {errorMessage && !isJobModalOpen && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{errorMessage}</div>
      )}

      {files.length > 0 && (
        <div className="mt-6 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-3">
              選択されたファイル（ドラッグで順序変更） - {files.length}件、合計: {(totalSize / 1024 / 1024).toFixed(1)}MB
            </h3>
            <div ref={containerRef} className="space-y-2">
              {files.map((uploadedFile) => (
                <div
                  key={uploadedFile.id}
                  data-id={uploadedFile.id}
                  className={`file-item bg-gray-50 border ${
                    uploadedFile.error ? 'border-red-300 bg-red-50' : 'border-gray-200'
                  } rounded-lg p-4 flex items-center justify-between`}
                >
                  <div className="flex items-center flex-1">
                    <div className="drag-handle cursor-move mr-3" aria-label="ドラッグで順序を入れ替え">
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </div>
                    <svg className="w-5 h-5 text-red-500 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{uploadedFile.file.name}</p>
                      <p className="text-xs text-gray-500">{(uploadedFile.file.size / 1024).toFixed(1)} KB</p>
                      {uploadedFile.error && <p className="text-xs text-red-600 mt-1">{uploadedFile.error}</p>}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(uploadedFile.id)}
                    className="ml-4 text-red-500 hover:text-red-700"
                    aria-label="ファイルを削除"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={executeMerge}
              disabled={!canExecute || mergeMutation.isPending || isPollingJob}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mergeMutation.isPending || isPollingJob ? 'PDF結合中...' : 'PDFを結合する'}
            </button>
            {!canExecute && (
              <p className="text-center text-sm text-red-600">
                {validFiles.length < 2
                  ? '2つ以上の有効なPDFファイルを選択してください'
                  : hasErrors
                  ? 'エラーのあるファイルを削除してください'
                  : '合計サイズが上限を超えています'}
              </p>
            )}
          </div>
        </div>
      )}

      <ProcessingModal
        isOpen={isJobModalOpen}
        title="PDF結合中..."
        message="結合処理には数秒かかる場合があります。画面を閉じずにお待ちください。"
        progress={progress}
        stepLabel={progressLabel}
      />

      {resultBlob && (
        <SuccessModal
          isOpen={showSuccess}
          filename={resultFilename}
          blob={resultBlob}
          onClose={() => setShowSuccess(false)}
          onNewProcess={handleReset}
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
