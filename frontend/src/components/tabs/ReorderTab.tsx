/**
 * ページ順入替タブ (プレースホルダー)
 */

export const ReorderTab = () => {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">ページ順入替</h2>
      <p className="text-sm text-gray-600 mb-6">PDFのページ順序をドラッグ&ドロップで変更します。</p>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
          <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-4 text-sm text-gray-600 font-medium">この機能は準備中です</p>
        <p className="mt-2 text-xs text-gray-500">今後のアップデートで実装予定です</p>
      </div>
    </div>
  );
};
