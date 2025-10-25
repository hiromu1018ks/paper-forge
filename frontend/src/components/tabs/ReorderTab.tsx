import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sortable from 'sortablejs';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import {
  inspectPdf,
  mergePdfs,
  reorderPdf,
  splitPdf,
  type MergeMeta,
  type PdfOperationResult,
  type ReorderMeta,
  type SourceFileMeta,
  type SplitMeta,
} from '@/api/pdf';
import { downloadJobResult } from '@/api/jobs';
import { ApiError } from '@/api/httpClient';
import { ErrorModal } from '@/components/modals/ErrorModal';
import { ProcessingModal } from '@/components/modals/ProcessingModal';
import { SuccessModal } from '@/components/modals/SuccessModal';
import { useJobPolling } from '@/hooks/useJobPolling';
import { jobStageToLabel } from '@/utils/jobProgress';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceResultMeta, WorkspaceResultType } from '@/types/workspace';
import { Toast, type ToastVariant } from '@/components/ui/Toast';

type ProgressStep = 'load' | 'process' | 'write' | 'complete';
type OperationKind = 'reorder' | 'split' | 'merge';

const OPERATION_PROGRESS_LABELS: Record<OperationKind, Record<ProgressStep, string>> = {
  reorder: {
    load: 'ファイルを読み込んでいます',
    process: 'ページ順を変更しています',
    write: '結果を書き出しています',
    complete: '処理が完了しました',
  },
  split: {
    load: 'ページデータを読み込んでいます',
    process: 'ページを抽出しています',
    write: 'ZIPを作成しています',
    complete: '処理が完了しました',
  },
  merge: {
    load: 'ファイルを読み込んでいます',
    process: 'PDFを結合しています',
    write: '結果を書き出しています',
    complete: '処理が完了しました',
  },
};

type PageItem = {
  id: string;
  originalIndex: number;
  selected: boolean;
};

const isPdfFile = (file: File): boolean => file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

const isReorderMeta = (meta: unknown): meta is ReorderMeta => {
  if (!meta || typeof meta !== 'object') return false;
  return 'order' in meta && Array.isArray((meta as ReorderMeta).order);
};

const isSplitMeta = (meta: unknown): meta is SplitMeta => {
  if (!meta || typeof meta !== 'object') return false;
  return 'ranges' in meta && Array.isArray((meta as SplitMeta).ranges);
};

const isMergeMeta = (meta: unknown): meta is MergeMeta => {
  if (!meta || typeof meta !== 'object') return false;
  return 'sources' in meta && Array.isArray((meta as MergeMeta).sources);
};

const getFriendlyApiMessage = (error: ApiError): string => {
  switch (error.code) {
    case 'INVALID_INPUT':
      return '入力内容に問題があります。内容を確認してください。';
    case 'LIMIT_EXCEEDED':
      return 'ファイルサイズまたはページ数の上限を超えています。';
    case 'UNSUPPORTED_PDF':
      return '処理できないPDFでした。別のファイルでお試しください。';
    default:
      return error.message || '予期しないエラーが発生しました。時間を置いて再度お試しください。';
  }
};

const createPages = (count: number): PageItem[] => {
  const seed = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `page-${seed}-${index}`,
    originalIndex: index,
    selected: false,
  }));
};

const formatFileSize = (bytes?: number | null): string => {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
};

const rangeExpressionFromSelection = (pages: PageItem[]): string | null => {
  const selected = pages
    .filter((page) => page.selected)
    .map((page) => page.originalIndex + 1)
    .sort((a, b) => a - b);

  if (selected.length === 0) {
    return null;
  }

  const ranges: string[] = [];
  let start = selected[0];
  let end = selected[0];

  for (let i = 1; i < selected.length; i += 1) {
    const value = selected[i];
    if (value === end + 1) {
      end = value;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = value;
    end = value;
  }

  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(',');
};

const normalizeRangesMeta = (rangesExpr: string): string[] =>
  rangesExpr
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

const splitRangesToString = (ranges: SplitMeta['ranges']): string[] =>
  ranges.map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`));

interface MergeItem {
  id: string;
  file: File;
  error?: string;
}

const MERGE_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MERGE_MAX_TOTAL_SIZE = 300 * 1024 * 1024; // 300MB
const MERGE_MAX_FILES = 20;

export const ReorderTab = () => {
  const [file, setFile] = useState<File | null>(null);
  const [sourceMeta, setSourceMeta] = useState<SourceFileMeta | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [splitRangeInput, setSplitRangeInput] = useState('');
  const [mergeFiles, setMergeFiles] = useState<MergeItem[]>([]);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultFilename, setResultFilename] = useState('reordered.pdf');
  const [showSuccess, setShowSuccess] = useState(false);

  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState<ProgressStep>('load');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStage, setJobStage] = useState<string | undefined>();
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [isPollingJob, setIsPollingJob] = useState(false);
  const [currentOperation, setCurrentOperation] = useState<OperationKind | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const navigate = useNavigate();
  const saveWorkspaceResult = useWorkspaceStore((state) => state.saveResult);
  const history = useWorkspaceStore((state) => state.history);

  const jobHandledRef = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sortableRef = useRef<Sortable | null>(null);
  const mergeSortableRef = useRef<Sortable | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const inspectRequestIdRef = useRef(0);
  const submittedOrderRef = useRef<number[]>([]);
  const submittedRangesRef = useRef<string>('');
  const submittedMergeFilesRef = useRef<MergeItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const mergeContainerRef = useRef<HTMLDivElement | null>(null);
  const [toasts, setToasts] = useState<{ id: string; message: string; variant: ToastVariant }[]>([]);

  const pushToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    setToasts((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, message, variant }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const jobQuery = useJobPolling({ jobId, enabled: isPollingJob });

  const selectedCount = useMemo(() => pages.filter((page) => page.selected).length, [pages]);
  const isOriginalOrder = useMemo(() => pages.every((page, index) => page.originalIndex === index), [pages]);
  const operationLabels = currentOperation ? OPERATION_PROGRESS_LABELS[currentOperation] : OPERATION_PROGRESS_LABELS.reorder;
  const progressLabel = jobStageToLabel(jobStage) ?? operationLabels[progressStep];
  const mergeTotalSize = useMemo(() => mergeFiles.reduce((sum, item) => sum + item.file.size, 0), [mergeFiles]);
  const mergeHasFileErrors = mergeFiles.some((item) => Boolean(item.error));
  const mergeValidFileCount = mergeFiles.filter((item) => !item.error).length;

  const resetJobState = useCallback((nextOperation: OperationKind | null = null) => {
    setResultBlob(null);
    setShowSuccess(false);
    setProgress(0);
    setProgressStep('load');
    setJobStage(undefined);
    setJobId(null);
    setIsPollingJob(false);
    setIsJobModalOpen(false);
    setCurrentOperation(nextOperation);
    jobHandledRef.current = false;
    if (nextOperation !== 'reorder') {
      submittedOrderRef.current = [];
    }
    if (nextOperation !== 'split') {
      submittedRangesRef.current = '';
    }
    if (nextOperation !== 'merge') {
      submittedMergeFilesRef.current = [];
    }
    setMergeError(null);
    setErrorMessage(null);
    switch (nextOperation) {
      case 'split':
        setResultFilename('split.zip');
        break;
      case 'merge':
        setResultFilename('merged.pdf');
        break;
      default:
        setResultFilename('reordered.pdf');
    }
  }, []);

  const beginOperation = useCallback(
    (operation: OperationKind) => {
      resetJobState(operation);
      setErrorMessage(null);
      setIsJobModalOpen(true);
      setProgress(5);
      setProgressStep('load');
    },
    [resetJobState]
  );

  const clearWorkspace = useCallback((options?: { preserveInspectError?: boolean }) => {
    setFile(null);
    setSourceMeta(null);
    setPages([]);
    if (!options?.preserveInspectError) {
      setInspectError(null);
    }
    setSplitRangeInput('');
    setMergeFiles([]);
    setMergeError(null);
    setIsInspecting(false);
    lastSelectedIndexRef.current = null;
    submittedOrderRef.current = [];
    submittedRangesRef.current = '';
    submittedMergeFilesRef.current = [];
    if (sortableRef.current) {
      sortableRef.current.destroy();
      sortableRef.current = null;
    }
    if (mergeSortableRef.current) {
      mergeSortableRef.current.destroy();
      mergeSortableRef.current = null;
    }
    setToasts([]);
  }, []);

  useEffect(
    () => () => {
      if (sortableRef.current) {
        sortableRef.current.destroy();
        sortableRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (!gridRef.current || pages.length === 0) {
      if (sortableRef.current) {
        sortableRef.current.destroy();
        sortableRef.current = null;
      }
      return;
    }

    if (sortableRef.current) {
      sortableRef.current.destroy();
      sortableRef.current = null;
    }

    sortableRef.current = Sortable.create(gridRef.current, {
      animation: 180,
      ghostClass: 'opacity-50',
      dragClass: 'ring-2 ring-blue-400',
      onEnd: (event) => {
        const oldIndex = event.oldIndex ?? -1;
        const newIndex = event.newIndex ?? -1;
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
        setPages((prev) => {
          const next = [...prev];
          const [moved] = next.splice(oldIndex, 1);
          next.splice(newIndex, 0, moved);
          return next;
        });
        lastSelectedIndexRef.current = newIndex;
      },
    });

    return () => {
      if (sortableRef.current) {
        sortableRef.current.destroy();
        sortableRef.current = null;
      }
    };
  }, [pages.length]);

  useEffect(() => {
    if (!mergeContainerRef.current || mergeFiles.length === 0) {
      if (mergeSortableRef.current) {
        mergeSortableRef.current.destroy();
        mergeSortableRef.current = null;
      }
      return;
    }

    if (mergeSortableRef.current) {
      mergeSortableRef.current.destroy();
      mergeSortableRef.current = null;
    }

    mergeSortableRef.current = Sortable.create(mergeContainerRef.current, {
      animation: 180,
      ghostClass: 'opacity-50',
      handle: '.merge-drag-handle',
      onEnd: (event) => {
        const oldIndex = event.oldIndex ?? -1;
        const newIndex = event.newIndex ?? -1;
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
        setMergeFiles((prev) => {
          const next = [...prev];
          const [moved] = next.splice(oldIndex, 1);
          next.splice(newIndex, 0, moved);
          return next;
        });
      },
    });

    return () => {
      if (mergeSortableRef.current) {
        mergeSortableRef.current.destroy();
        mergeSortableRef.current = null;
      }
    };
  }, [mergeFiles.length]);

  useEffect(() => {
    if (mergeFiles.length === 0) {
      setMergeError(null);
      return;
    }
    if (mergeTotalSize > MERGE_MAX_TOTAL_SIZE) {
      setMergeError(`合計サイズが300MBを超えています（${(mergeTotalSize / 1024 / 1024).toFixed(1)}MB）`);
    } else if (mergeError && mergeError.includes('300MB')) {
      setMergeError(null);
    }
  }, [mergeFiles, mergeTotalSize, mergeError]);

  const loadFile = useCallback(
    async (selectedFile: File) => {
      if (!isPdfFile(selectedFile)) {
        setInspectError('PDFファイルのみ選択できます。');
        return;
      }

      resetJobState(null);
      inspectRequestIdRef.current += 1;
      const requestId = inspectRequestIdRef.current;

      setFile(selectedFile);
      setInspectError(null);
      setIsInspecting(true);
      setSourceMeta(null);
      setSplitRangeInput('');
      setPages([]);
      lastSelectedIndexRef.current = null;

      if (sortableRef.current) {
        sortableRef.current.destroy();
        sortableRef.current = null;
      }

      try {
        const response = await inspectPdf(selectedFile);
        if (inspectRequestIdRef.current !== requestId) {
          return;
        }
        setSourceMeta(response.source);
        setPages(createPages(response.source.pages));
      } catch (error) {
        if (inspectRequestIdRef.current !== requestId) {
          return;
        }
        const message =
          error instanceof ApiError
            ? getFriendlyApiMessage(error)
            : error instanceof Error
              ? error.message
              : 'PDFの解析に失敗しました。';
        clearWorkspace({ preserveInspectError: true });
        setInspectError(message);
      } finally {
        if (inspectRequestIdRef.current === requestId) {
          setIsInspecting(false);
        }
      }
    },
    [clearWorkspace, resetJobState]
  );

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) {
      void loadFile(selected);
    }
    event.target.value = '';
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      void loadFile(dropped);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }
    setIsDragActive(false);
  };

  const validateMergeFile = (mergeFile: File): string | null => {
    if (!mergeFile.name.toLowerCase().endsWith('.pdf')) {
      return 'PDFファイルのみアップロードできます';
    }
    if (mergeFile.type && mergeFile.type !== 'application/pdf') {
      return 'PDFファイルではありません';
    }
    if (mergeFile.size > MERGE_MAX_FILE_SIZE) {
      return `ファイルサイズが100MBを超えています（${(mergeFile.size / 1024 / 1024).toFixed(1)}MB）`;
    }
    return null;
  };

  const appendMergeFiles = (selectedFiles: File[]) => {
    if (selectedFiles.length === 0) {
      return;
    }

    setMergeError(null);

    if (mergeFiles.length + selectedFiles.length > MERGE_MAX_FILES) {
      setMergeError(`ファイル数は${MERGE_MAX_FILES}個以下にしてください`);
      return;
    }

    const newItems: MergeItem[] = selectedFiles.map((item, index) => ({
      id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      file: item,
      error: validateMergeFile(item) ?? undefined,
    }));

    const combined = [...mergeFiles, ...newItems];
    const totalSize = combined.reduce((sum, current) => sum + current.file.size, 0);
    if (totalSize > MERGE_MAX_TOTAL_SIZE) {
      setMergeError(`合計サイズが300MBを超えています（${(totalSize / 1024 / 1024).toFixed(1)}MB）`);
      return;
    }

    setMergeFiles(combined);
  };

  const handleMergeFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    appendMergeFiles(selected);
    event.target.value = '';
  };

  const handleMergeDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files ?? []).filter((item) => item.type === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf'));
    appendMergeFiles(dropped);
  };

  const removeMergeFile = (id: string) => {
    setMergeFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const clearMergeFiles = () => {
    setMergeFiles([]);
    setMergeError(null);
  };

  const handlePageClick = (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
    setPages((prev) => {
      const next = prev.map((page) => ({ ...page }));

      if (event.shiftKey && lastSelectedIndexRef.current !== null) {
        const start = Math.min(index, lastSelectedIndexRef.current);
        const end = Math.max(index, lastSelectedIndexRef.current);
        const preserve = event.metaKey || event.ctrlKey;
        for (let i = 0; i < next.length; i += 1) {
          if (i >= start && i <= end) {
            next[i].selected = true;
          } else if (!preserve) {
            next[i].selected = false;
          }
        }
        return next;
      }

      if (event.metaKey || event.ctrlKey) {
        next[index].selected = !next[index].selected;
        return next;
      }

      for (let i = 0; i < next.length; i += 1) {
        next[i].selected = i === index;
      }
      return next;
    });
    lastSelectedIndexRef.current = index;
  };

  const handleSelectAll = () => {
    setPages((prev) => prev.map((page) => ({ ...page, selected: true })));
  };

  const handleClearSelection = () => {
    setPages((prev) => prev.map((page) => ({ ...page, selected: false })));
    lastSelectedIndexRef.current = null;
  };

  const handleRestoreOrder = () => {
    setPages((prev) => {
      const sorted = [...prev].sort((a, b) => a.originalIndex - b.originalIndex);
      return sorted.map((page) => ({ ...page, selected: false }));
    });
    lastSelectedIndexRef.current = null;
  };

  const handleResetWorkspace = () => {
    clearWorkspace();
    resetJobState(null);
  };

  const handleApplySelectionToRanges = () => {
    const expression = rangeExpressionFromSelection(pages);
    if (!expression) {
      setErrorMessage('分割したいページを選択するか、ページ範囲を手入力してください。');
      return;
    }
    setSplitRangeInput(expression);
    setErrorMessage(null);
  };

  const canReorderExecute = Boolean(file) && pages.length > 0 && !isInspecting;
  const canSplitExecute = Boolean(file) && !isInspecting && splitRangeInput.trim().length > 0;
  const canMergeExecute = mergeValidFileCount >= 2 && !mergeHasFileErrors && !mergeError;

  const reorderMutation = useMutation({
    mutationFn: async (order: number[]): Promise<PdfOperationResult> => {
      if (!file) {
        throw new Error('PDFファイルが選択されていません。');
      }
      if (order.length === 0) {
        throw new Error('ページ順序が空です。');
      }
      return reorderPdf({
        file,
        order,
      });
    },
    onMutate: (order) => {
      submittedOrderRef.current = [...order];
      beginOperation('reorder');
      pushToast('ページ順入替を開始しました。', 'info');
    },
    onSuccess: async (result, order) => {
      if (!file) {
        return;
      }

      if (result.type === 'inline') {
        try {
          const blob = result.blob;
          const filename = result.filename || 'reordered.pdf';
          const orderMeta = order.map((value) => value + 1);
          await saveWorkspaceResult({
            blob,
            filename,
            type: result.resultKind,
            source: 'reorder',
            meta: {
              inputFilenames: [file.name],
              order: orderMeta,
            },
          });
          setResultBlob(blob);
          setResultFilename(filename);
          setProgress(100);
          setProgressStep('complete');
          setShowSuccess(true);
          pushToast('ページ順入替が完了しました。', 'success');
        } catch (storageError) {
          console.error(storageError);
          setErrorMessage('結果の保存に失敗しました。もう一度お試しください。');
          pushToast('結果の保存に失敗しました。', 'error');
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
      let message: string;
      if (error instanceof ApiError) {
        message = getFriendlyApiMessage(error);
      } else if (error instanceof Error) {
        message = error.message;
      } else {
        message = '予期しないエラーが発生しました。時間を置いて再度お試しください。';
      }
      setErrorMessage(message);
      if (currentOperation === 'merge') {
        setMergeError(message);
      }
      pushToast(message, 'error');
    },
  });

  const splitMutation = useMutation({
    mutationFn: async (rangesExpr: string): Promise<PdfOperationResult> => {
      if (!file) {
        throw new Error('PDFファイルが選択されていません。');
      }
      const trimmed = rangesExpr.trim();
      if (!trimmed) {
        throw new Error('ページ範囲を入力してください。');
      }
      return splitPdf({
        file,
        ranges: trimmed,
      });
    },
    onMutate: (rangesExpr) => {
      submittedRangesRef.current = rangesExpr.trim();
      beginOperation('split');
      pushToast('ページ分割を開始しました。', 'info');
    },
    onSuccess: async (result, rangesExpr) => {
      if (!file) {
        return;
      }

      if (result.type === 'inline') {
        try {
          const blob = result.blob;
          const filename = result.filename || 'split.zip';
          await saveWorkspaceResult({
            blob,
            filename,
            type: result.resultKind,
            source: 'split',
            meta: {
              inputFilenames: [file.name],
              ranges: normalizeRangesMeta(rangesExpr),
            },
          });
          setResultBlob(blob);
          setResultFilename(filename);
          setProgress(100);
          setProgressStep('complete');
          setShowSuccess(true);
          pushToast('指定範囲での分割が完了しました。', 'success');
        } catch (storageError) {
          console.error(storageError);
          setErrorMessage('結果の保存に失敗しました。もう一度お試しください。');
          pushToast('結果の保存に失敗しました。', 'error');
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
        const message = getFriendlyApiMessage(error);
        setErrorMessage(message);
        pushToast(message, 'error');
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
        pushToast(error.message, 'error');
      } else {
        const message = '予期しないエラーが発生しました。時間を置いて再度お試しください。';
        setErrorMessage(message);
        pushToast(message, 'error');
      }
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async (): Promise<PdfOperationResult> => {
      const validFiles = mergeFiles.filter((item) => !item.error).map((item) => item.file);
      if (validFiles.length < 2) {
        throw new Error('2つ以上の有効なPDFファイルを選択してください。');
      }
      return mergePdfs({ files: validFiles });
    },
    onMutate: () => {
      submittedMergeFilesRef.current = mergeFiles.map((item) => ({ ...item }));
      setMergeError(null);
      beginOperation('merge');
      pushToast('PDF結合を開始しました。', 'info');
    },
    onSuccess: async (result) => {
      const validFiles = submittedMergeFilesRef.current.filter((item) => !item.error);
      if (result.type === 'inline') {
        try {
          const blob = result.blob;
          const filename = result.filename || 'merged.pdf';
          await saveWorkspaceResult({
            blob,
            filename,
            type: result.resultKind,
            source: 'merge',
            meta: {
              inputFilenames: validFiles.map((item) => item.file.name),
            },
          });
          setResultBlob(blob);
          setResultFilename(filename);
          setMergeFiles([]);
          setMergeError(null);
          setProgress(100);
          setProgressStep('complete');
          setShowSuccess(true);
          pushToast('PDF結合が完了しました。', 'success');
        } catch (storageError) {
          console.error(storageError);
          setErrorMessage('結果の保存に失敗しました。もう一度お試しください。');
          pushToast('結果の保存に失敗しました。', 'error');
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
        const message = getFriendlyApiMessage(error);
        setErrorMessage(message);
        setMergeError(message);
        pushToast(message, 'error');
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
        setMergeError(error.message);
        pushToast(error.message, 'error');
      } else {
        const message = '予期しないエラーが発生しました。時間を置いて再度お試しください。';
        setErrorMessage(message);
        setMergeError(message);
        pushToast(message, 'error');
      }
    },
  });

  const handleReorderSubmit = () => {
    if (!file || pages.length === 0 || isInspecting) return;
    const order = pages.map((page) => page.originalIndex);
    reorderMutation.mutate(order);
  };

  const handleSplitSubmit = () => {
    const trimmed = splitRangeInput.trim();
    if (!file) {
      setErrorMessage('まずPDFファイルを読み込んでください。');
      return;
    }
    if (!trimmed) {
      setErrorMessage('ページ範囲を入力してください。');
      return;
    }
    splitMutation.mutate(trimmed);
  };

  const handleMergeSubmit = () => {
    if (!canMergeExecute) {
      setMergeError('2つ以上のPDFを追加し、エラーのあるファイルを取り除いてください。');
      return;
    }
    mergeMutation.mutate();
  };

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
          const { blob, filename, contentType } = await downloadJobResult(info.jobId);
          const workspaceType: WorkspaceResultType = info.operation === 'split' || contentType === 'application/zip' ? 'zip' : 'pdf';
          const workspaceSource = (info.operation as OperationKind) ?? (currentOperation ?? 'reorder');
          let workspaceMeta: WorkspaceResultMeta | undefined;

          if (isReorderMeta(info.meta)) {
            workspaceMeta = {
              inputFilenames: [info.meta.original.name],
              order: info.meta.order.map((value) => value + 1),
            };
          } else if (isSplitMeta(info.meta)) {
            workspaceMeta = {
              inputFilenames: [info.meta.original.name],
              ranges: splitRangesToString(info.meta.ranges),
            };
          } else if (isMergeMeta(info.meta)) {
            workspaceMeta = {
              inputFilenames: info.meta.sources.map((source) => source.name),
              pageCount: info.meta.totalPages,
            };
          } else if (workspaceSource === 'reorder' && submittedOrderRef.current.length > 0 && file) {
            workspaceMeta = {
              inputFilenames: [file.name],
              order: submittedOrderRef.current.map((value) => value + 1),
            };
          } else if (workspaceSource === 'split' && submittedRangesRef.current && file) {
            workspaceMeta = {
              inputFilenames: [file.name],
              ranges: normalizeRangesMeta(submittedRangesRef.current),
            };
          } else if (workspaceSource === 'merge' && submittedMergeFilesRef.current.length > 0) {
            workspaceMeta = {
              inputFilenames: submittedMergeFilesRef.current.filter((item) => !item.error).map((item) => item.file.name),
            };
          }

          await saveWorkspaceResult({
            blob,
            filename,
            type: workspaceType,
            source: workspaceSource,
            meta: workspaceMeta,
          });
          setResultBlob(blob);
          setResultFilename(filename);
          setProgress(100);
          setProgressStep('complete');
          setShowSuccess(true);
          if (workspaceSource === 'merge') {
            setMergeFiles([]);
            setMergeError(null);
          }
          const successMessage =
            workspaceSource === 'split'
              ? '指定範囲での分割が完了しました。'
              : workspaceSource === 'merge'
                ? 'PDF結合が完了しました。'
                : 'ページ順入替が完了しました。';
          pushToast(successMessage, 'success');
        } catch (downloadError) {
          console.error(downloadError);
          if (downloadError instanceof ApiError) {
            const message = getFriendlyApiMessage(downloadError);
            setErrorMessage(message);
            pushToast(message, 'error');
          } else if (downloadError instanceof Error) {
            setErrorMessage(downloadError.message);
            pushToast(downloadError.message, 'error');
          } else {
            const message = 'ジョブ結果の取得に失敗しました。';
            setErrorMessage(message);
            pushToast(message, 'error');
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
        pushToast(info.error.message, 'error');
      } else {
        const message = 'ジョブが失敗しました。入力内容を確認してください。';
        setErrorMessage(message);
        pushToast(message, 'error');
      }
    }
  }, [jobQuery.data, currentOperation, file, saveWorkspaceResult, pushToast]);

  useEffect(() => {
    if (!jobQuery.error) return;
    jobHandledRef.current = true;
    setIsPollingJob(false);
    setIsJobModalOpen(false);
    setJobId(null);
    setJobStage(undefined);
    setErrorMessage(jobQuery.error.message);
    pushToast(jobQuery.error.message, 'error');
  }, [jobQuery.error, pushToast]);

  const processingModalTitle =
    currentOperation === 'split'
      ? 'ページ分割を実行中...'
      : currentOperation === 'merge'
        ? 'PDF結合を実行中...'
        : 'ページ順入替を実行中...';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="mb-6 space-y-2">
        <h2 className="text-lg font-medium text-gray-900">ページ編集ワークスペース</h2>
        <p className="text-sm text-gray-600">
          PDFを読み込むとページサムネイルのグリッドが表示され、ドラッグ＆ドロップで順序を並べ替えたり、選択範囲を分割できます。
          今後は結合などもこのワークスペースから操作できるよう拡張予定です。
        </p>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <div className="space-y-4">
            <label
              htmlFor="reorder-file-input"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-6 text-center transition-colors ${
                isDragActive ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-300 text-gray-500 hover:border-blue-400'
              } ${file ? 'bg-gray-50' : 'bg-white'}`}
            >
              <div className="flex flex-col items-center space-y-2">
                <svg className="h-8 w-8 text-current" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M5 7l6-4 6 4M5 7h14" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-current">PDFをここにドラッグ＆ドロップ</p>
                  <p className="text-xs text-gray-500">またはファイルを選択</p>
                </div>
                {file ? (
                  <p className="text-xs text-gray-600">
                    現在のファイル: <span className="font-medium text-gray-800">{file.name}</span>
                  </p>
                ) : null}
              </div>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              id="reorder-file-input"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            {inspectError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{inspectError}</div>
            )}

            {isInspecting && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="aspect-[3/4] rounded-lg border border-gray-200 bg-gray-100 animate-pulse" />
                ))}
              </div>
            )}

            {!isInspecting && pages.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between text-sm text-gray-600">
                  <span>
                    全{pages.length}ページ中 <span className="font-medium text-gray-900">{selectedCount}</span>ページ選択中
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                    >
                      すべて選択
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                    >
                      選択解除
                    </button>
                  </div>
                </div>
                <div ref={gridRef} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {pages.map((page, index) => {
                    const isMoved = page.originalIndex !== index;
                    return (
                      <button
                        type="button"
                        key={page.id}
                        onClick={(event) => handlePageClick(index, event)}
                        className={`group relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-white text-left shadow-sm transition-all ${
                          page.selected
                            ? 'border-blue-500 ring-2 ring-blue-200'
                            : 'border-gray-200 hover:-translate-y-1 hover:border-blue-400 hover:shadow-md'
                        }`}
                      >
                        <div className="relative flex h-full flex-1 items-center justify-center bg-slate-50">
                          <span className="text-2xl font-semibold text-gray-400">Page {index + 1}</span>
                          <span className="absolute top-2 left-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-gray-700 shadow">
                            元 {page.originalIndex + 1}
                          </span>
                          {isMoved && (
                            <span className="absolute bottom-2 left-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 shadow">
                              現在 {index + 1}
                            </span>
                          )}
                          {page.selected && (
                            <span className="absolute bottom-2 right-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white shadow">
                              選択中
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {file && !isInspecting && pages.length === 0 && !inspectError && (
              <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
                ページ情報を取得できませんでした。別のPDFファイルでお試しください。
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-900">並べ替え</h3>
            <p className="mt-1 text-xs text-gray-500">ドラッグ＆ドロップで順序を調整し、反映ボタンで新しいPDFを生成します。</p>
            <button
              type="button"
              onClick={handleReorderSubmit}
              disabled={!canReorderExecute || reorderMutation.isPending || splitMutation.isPending || isPollingJob}
              className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
            >
              {reorderMutation.isPending || (isPollingJob && currentOperation === 'reorder') ? 'ページを並べ替えています...' : 'ページ順を適用する'}
            </button>
            <button
              type="button"
              onClick={handleRestoreOrder}
              disabled={pages.length === 0 || isOriginalOrder || isInspecting}
              className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              元の順序に戻す
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-900">分割・抽出</h3>
            <p className="mt-1 text-xs text-gray-500">
              選択したページから自動で範囲を作成するか、手動で「1-3,7」のように入力してZIPを生成します。
            </p>
            <div className="mt-3 space-y-2">
              <textarea
                rows={3}
                value={splitRangeInput}
                onChange={(event) => setSplitRangeInput(event.target.value)}
                placeholder="例: 1-3,7"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleApplySelectionToRanges}
                  disabled={pages.length === 0 || isInspecting}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  選択ページを範囲に反映
                </button>
                <button
                  type="button"
                  onClick={() => setSplitRangeInput(sourceMeta ? `1-${sourceMeta.pages}` : '')}
                  disabled={!sourceMeta || isInspecting}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  全ページを指定
                </button>
              </div>
              <button
                type="button"
                onClick={handleSplitSubmit}
                disabled={!canSplitExecute || splitMutation.isPending || reorderMutation.isPending || isPollingJob}
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-200"
              >
                {splitMutation.isPending || (isPollingJob && currentOperation === 'split') ? 'ページを抽出しています...' : '指定範囲で分割する'}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-900">PDF結合</h3>
            <p className="mt-1 text-xs text-gray-500">複数のPDFをまとめて1つに結合します。順序はドラッグ＆ドロップで変更できます。</p>
            <div
              onDrop={handleMergeDrop}
              onDragOver={(event) => event.preventDefault()}
              className="mt-3 flex flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-center"
            >
              <svg className="h-6 w-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7M5 7l6-4 6 4M5 7h14" />
              </svg>
              <p className="mt-2 text-xs text-gray-600">ファイルをドラッグ＆ドロップ</p>
              <p className="text-[11px] text-gray-400">または、下のボタンから選択</p>
              <button
                type="button"
                onClick={() => mergeInputRef.current?.click()}
                className="mt-3 rounded-full border border-gray-300 px-4 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                PDFを追加する
              </button>
            </div>
            <input
              ref={mergeInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={handleMergeFileChange}
              className="hidden"
            />

            {mergeError && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{mergeError}</div>}

            {mergeFiles.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{mergeFiles.length} ファイル</span>
                  <span>合計サイズ: {formatFileSize(mergeTotalSize)}</span>
                </div>
                <div ref={mergeContainerRef} className="space-y-2">
                  {mergeFiles.map((item) => (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs shadow-sm ${
                        item.error ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className="merge-drag-handle mt-1 h-4 w-4 cursor-grab text-gray-400 hover:text-gray-600"
                          aria-label="ドラッグして順序を変更"
                        >
                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9h8M8 15h8" />
                          </svg>
                        </button>
                        <div>
                          <p className="max-w-[160px] truncate font-medium text-gray-800">{item.file.name}</p>
                          <p className="text-[11px] text-gray-500">{formatFileSize(item.file.size)}</p>
                          {item.error && <p className="text-[11px] text-red-600">{item.error}</p>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeMergeFile(item.id)}
                        className="rounded-full border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleMergeSubmit}
                    disabled={!canMergeExecute || mergeMutation.isPending || reorderMutation.isPending || splitMutation.isPending || isPollingJob}
                    className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
                  >
                    {mergeMutation.isPending || (isPollingJob && currentOperation === 'merge') ? 'PDFを結合しています...' : '選択したPDFを結合する'}
                  </button>
                  <button
                    type="button"
                    onClick={clearMergeFiles}
                    disabled={mergeFiles.length === 0}
                    className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed"
                  >
                    リストをクリア
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/60 p-5">
            <h3 className="text-sm font-medium text-blue-900">近日追加予定</h3>
            <p className="mt-1 text-xs text-blue-800">
              複数ファイルの結合や選択状態の履歴、Undo/Redoなど、iLovePDFに近い操作感を提供する機能を順次追加していきます。
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-900">最近の処理結果</h3>
            {history.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500">まだ処理結果はありません。タスクを実行するとここに履歴が表示されます。</p>
            ) : (
              <ul className="mt-3 space-y-2 text-xs text-gray-600">
                {history.slice(0, 4).map((entry) => (
                  <li key={entry.id} className="flex flex-col rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{entry.source}</span>
                    <span className="truncate text-gray-800">{entry.filename}</span>
                    <span className="text-[11px] text-gray-500">{new Date(entry.createdAt).toLocaleString('ja-JP')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-900">ファイル情報</h3>
            {file ? (
              <dl className="mt-3 space-y-2 text-sm text-gray-600">
                <div className="flex justify-between">
                  <dt>ファイル名</dt>
                  <dd className="truncate pl-4 text-right text-gray-800">{file.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>サイズ</dt>
                  <dd className="text-gray-800">{formatFileSize(file.size)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>ページ数</dt>
                  <dd className="text-gray-800">{sourceMeta?.pages ?? '-'}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-xs text-gray-500">ファイルを読み込むと詳細が表示されます。</p>
            )}
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {file ? '別のPDFに差し替える' : 'PDFを選択する'}
              </button>
              {file && (
                <button
                  type="button"
                  onClick={handleResetWorkspace}
                  className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
                >
                  ワークスペースをリセット
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {errorMessage && !isJobModalOpen && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      )}

      <ProcessingModal
        isOpen={isJobModalOpen}
        title={processingModalTitle}
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
            setShowSuccess(false);
            handleResetWorkspace();
          }}
          onViewWorkspace={() => {
            setShowSuccess(false);
            navigate('/workspace');
          }}
        />
      )}

      <ErrorModal isOpen={!!errorMessage && !isJobModalOpen} message={errorMessage ?? ''} onClose={() => setErrorMessage(null)} />
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onDismiss={dismissToast} />
        ))}
      </div>
    </div>
  );
};
