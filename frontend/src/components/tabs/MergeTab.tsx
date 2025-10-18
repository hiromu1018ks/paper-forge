/**
 * PDF結合タブ (SortableJS + Tailwind CSS)
 */

import { useRef, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Sortable from 'sortablejs';
import { mergePdfs } from '@/api/pdf';
import { ApiError } from '@/api/httpClient';
import { ProcessingModal } from '@/components/modals/ProcessingModal';
import { SuccessModal } from '@/components/modals/SuccessModal';
import { ErrorModal } from '@/components/modals/ErrorModal';

interface UploadedFile {
  id: string;
  file: File;
  error?: string;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_TOTAL_SIZE = 300 * 1024 * 1024; // 300MB
const MAX_FILES = 20;

export const MergeTab = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sortableRef = useRef<Sortable | null>(null);

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
    if (selectedFiles.length === 0) {
      return;
    }
    setErrorMessage(null);

    if (files.length + selectedFiles.length > MAX_FILES) {
      setErrorMessage(`ファイル数は${MAX_FILES}個以下にしてください`);
      return;
    }

    const newFiles: UploadedFile[] = selectedFiles.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      error: validateFile(file) || undefined,
    }));

    const combined = [...files, ...newFiles];
    setFiles(combined);

    const totalSize = combined.reduce((sum, f) => sum + f.file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      setErrorMessage(`合計サイズが300MBを超えています（${(totalSize / 1024 / 1024).toFixed(1)}MB）`);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    appendFiles(selectedFiles);

    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) => file.type === 'application/pdf');
    appendFiles(droppedFiles);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setErrorMessage(null);
  };

  // SortableJS setup
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
          const oldIndex = evt.oldIndex;
          const newIndex = evt.newIndex;
          if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== newIndex) {
            setFiles((prevFiles) => {
              const newFiles = [...prevFiles];
              const [movedFile] = newFiles.splice(oldIndex, 1);
              newFiles.splice(newIndex, 0, movedFile);
              return newFiles;
            });
          }
        },
      });
    }

    return () => {
      if (sortableRef.current) {
        sortableRef.current.destroy();
      }
    };
  }, [files.length]);

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const validFiles = files.filter((f) => !f.error);
      if (validFiles.length === 0) {
        throw new Error('有効なファイルがありません');
      }

      const blob = await mergePdfs({
        files: validFiles.map((f) => f.file),
      });

      return blob;
    },
    onSuccess: (blob) => {
      setResultBlob(blob);
      setShowSuccess(true);
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : undefined;
      setErrorMessage(apiError?.message || (error instanceof Error ? error.message : '予期しないエラーが発生しました'));
    },
  });

  const handleReset = () => {
    setFiles([]);
    setResultBlob(null);
    setShowSuccess(false);
    setErrorMessage(null);
  };

  const validFiles = files.filter((f) => !f.error);
  const hasErrors = files.some((f) => f.error);
  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
  const canExecute = validFiles.length >= 2 && !hasErrors && totalSize <= MAX_TOTAL_SIZE;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">PDF結合</h2>
      <p className="text-sm text-gray-600 mb-6">
        複数のPDFファイルを1つに結合します。ドラッグ&ドロップで順序を変更できます。
      </p>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drag-over');
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

      {/* Error Message */}
      {errorMessage && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {errorMessage}
        </div>
      )}

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-6">
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
                  <div className="drag-handle cursor-move mr-3">
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
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => mergeMutation.mutate()}
            disabled={!canExecute || mergeMutation.isPending}
            className="mt-6 w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mergeMutation.isPending ? 'PDF結合中...' : 'PDFを結合する'}
          </button>

          {!canExecute && (
            <p className="mt-2 text-center text-sm text-red-600">
              {validFiles.length < 2
                ? '2つ以上の有効なPDFファイルを選択してください'
                : hasErrors
                ? 'エラーのあるファイルを削除してください'
                : '合計サイズが上限を超えています'}
            </p>
          )}
        </div>
      )}

      {/* Modals */}
      <ProcessingModal isOpen={mergeMutation.isPending} title="PDF結合中..." message="ファイルを結合しています" />
      {resultBlob && (
        <SuccessModal
          isOpen={showSuccess}
          filename="merged.pdf"
          blob={resultBlob}
          onClose={() => setShowSuccess(false)}
          onNewProcess={handleReset}
        />
      )}
      <ErrorModal isOpen={!!errorMessage && !mergeMutation.isPending} message={errorMessage || ''} onClose={() => setErrorMessage(null)} />
    </div>
  );
};
