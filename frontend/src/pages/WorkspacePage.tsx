/**
 * ワークスペース画面 (S-07)
 *
 * - 直近の処理結果をプレビューおよびダウンロード可能な形で表示
 * - 続けて処理する導線を用意し、MainApp のタブへ遷移させる
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkspaceResult } from '@/types/workspace';

const TAB_LABELS: Record<WorkspaceResult['source'], string> = {
  merge: '結合',
  reorder: 'ページ順入替',
  split: '分割',
  optimize: '圧縮',
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[power]}`;
};

const formatDateTime = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
};

const hashPreview = (hash?: string): string => {
  if (!hash) return '未計測';
  return hash.slice(0, 8);
};

export const WorkspacePage = () => {
  const navigate = useNavigate();
  const lastResult = useWorkspaceStore((state) => state.lastResult);
  const history = useWorkspaceStore((state) => state.history);
  const previewUrl = useWorkspaceStore((state) => state.previewUrl);
  const ensurePreviewUrl = useWorkspaceStore((state) => state.ensurePreviewUrl);
  const getLastResultBlob = useWorkspaceStore((state) => state.getLastResultBlob);
  const clearLastResult = useWorkspaceStore((state) => state.clearLastResult);

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (lastResult && !previewUrl) {
      void ensurePreviewUrl();
    }
  }, [ensurePreviewUrl, lastResult, previewUrl]);

  const continueActions = useMemo(
    () => [
      { label: '結合を続ける', tab: 'merge' as const, description: '別のファイルを結合する' },
      { label: '圧縮に送る', tab: 'optimize' as const, description: '容量を減らして共有しやすくする' },
      { label: 'ページ順を調整', tab: 'reorder' as const, description: '並び順を整えてから出力する' },
      { label: 'ページを分割', tab: 'split' as const, description: '必要なページでファイルを分ける' },
    ],
    []
  );

  const handleDownload = async () => {
    if (!lastResult) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const blob = await getLastResultBlob();
      if (!blob) {
        setDownloadError('保存された結果が見つかりませんでした。再度処理を実行してください。');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = lastResult.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('ダウンロードに失敗しました:', error);
      setDownloadError('ダウンロードに失敗しました。時間を置いて再度お試しください。');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleNavigateToTab = (tab: WorkspaceResult['source']) => {
    navigate('/app', { state: { activeTab: tab, fromWorkspace: true } });
  };

  const handleStartNewMerge = () => {
    navigate('/app', { state: { activeTab: 'merge', fromWorkspace: true } });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">ワークスペース</h1>
            <p className="mt-1 text-sm text-gray-500">直近で生成したファイルを保持し、続けて処理を行えます。</p>
          </div>
          <button
            onClick={handleStartNewMerge}
            className="px-4 py-2 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            結合画面へ戻る
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {!lastResult ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
            <h2 className="text-lg font-medium text-gray-900">保存済みの結果はありません</h2>
            <p className="mt-2 text-sm text-gray-500">
              まずは「結合」タブで PDF を処理すると、ここに直近の結果が表示されます。
            </p>
            <button
              onClick={handleStartNewMerge}
              className="mt-6 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
            >
              結合を開始する
            </button>
          </div>
        ) : (
          <div className="space-y-10">
            <section className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-5 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900">直近の結果</h2>
              </div>
              <div className="px-6 py-6 grid gap-8 md:grid-cols-2">
                <div>
                  <dl className="space-y-3 text-sm text-gray-600">
                    <div>
                      <dt className="font-medium text-gray-700">ファイル名</dt>
                      <dd className="mt-1">{lastResult.filename}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">生成時刻</dt>
                      <dd className="mt-1">{formatDateTime(lastResult.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">サイズ</dt>
                      <dd className="mt-1">{formatBytes(lastResult.size)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-700">ハッシュ (先頭8文字)</dt>
                      <dd className="mt-1 font-mono text-gray-800">{hashPreview(lastResult.hash)}</dd>
                    </div>
                    {lastResult.meta?.inputFilenames && (
                      <div>
                        <dt className="font-medium text-gray-700">入力ファイル</dt>
                        <dd className="mt-1 space-y-1">
                          {lastResult.meta.inputFilenames.map((name) => (
                            <p key={name} className="truncate">
                              {name}
                            </p>
                          ))}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-6 space-y-3">
                    <button
                      onClick={handleDownload}
                      disabled={isDownloading}
                      className="w-full inline-flex justify-center items-center px-4 py-2 bg-green-500 text-white rounded-md shadow-sm hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-300 focus:ring-offset-2 disabled:opacity-50"
                    >
                      {isDownloading ? 'ダウンロード準備中...' : 'ダウンロード'}
                    </button>
                    <button
                      onClick={() => {
                        void clearLastResult();
                      }}
                      className="w-full inline-flex justify-center items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                    >
                      結果を削除
                    </button>
                    {downloadError && <p className="text-sm text-red-600">{downloadError}</p>}
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden h-[420px]">
                  {previewUrl && lastResult.type === 'pdf' ? (
                    <iframe title="PDFプレビュー" src={previewUrl} className="w-full h-full" />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-sm text-gray-500">
                      <svg className="w-10 h-10 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M12 12l3 3m0 0l3-3m-3 3V4m-4 2H6a2 2 0 00-2 2v10a2 2 0 002 2h6"
                        />
                      </svg>
                      <p>プレビューを表示できません。</p>
                      <p>ダウンロードして内容をご確認ください。</p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-5 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900">続けて処理する</h2>
                <p className="mt-1 text-sm text-gray-500">同じファイルを使って別の操作に進めます。</p>
              </div>
              <div className="px-6 py-6 grid gap-4 md:grid-cols-2">
                {continueActions.map((action) => (
                  <button
                    key={action.tab}
                    onClick={() => handleNavigateToTab(action.tab)}
                    className="text-left border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-900">{action.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{action.description}</p>
                  </button>
                ))}
              </div>
            </section>

            {history.length > 1 && (
              <section className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-6 py-5 border-b border-gray-200">
                  <h2 className="text-lg font-medium text-gray-900">履歴</h2>
                  <p className="mt-1 text-sm text-gray-500">直近の結果を最大5件まで記録しています。</p>
                </div>
                <div className="px-6 py-6 space-y-3 text-sm text-gray-700">
                  {history.map((item, index) => (
                    <div
                      key={`${item.id}-${index}`}
                      className="flex flex-col md:flex-row md:items-center md:justify-between border border-gray-100 rounded-md px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{item.filename}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDateTime(item.createdAt)} / {formatBytes(item.size)} / {hashPreview(item.hash)}
                        </p>
                      </div>
                      <div className="mt-2 md:mt-0">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs bg-blue-50 text-blue-600">
                          {TAB_LABELS[item.source]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
