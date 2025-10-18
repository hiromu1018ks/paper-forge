/**
 * PDF圧縮タブ (プレースホルダー)
 */

export const OptimizeTab = () => {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">PDF圧縮</h2>
      <p className="text-sm text-gray-600 mb-6">PDFファイルを最適化してサイズを削減します。</p>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-4 text-sm text-gray-600 font-medium">この機能は準備中です</p>
        <p className="mt-2 text-xs text-gray-500">今後のアップデートで実装予定です</p>
      </div>
    </div>
  );
};
