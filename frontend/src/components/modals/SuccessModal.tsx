/**
 * 処理完了モーダル
 */

interface SuccessModalProps {
  isOpen: boolean;
  filename: string;
  blob: Blob;
  onClose: () => void;
  onNewProcess: () => void;
  onViewWorkspace?: () => void;
}

export const SuccessModal = ({ isOpen, filename, blob, onClose, onNewProcess, onViewWorkspace }: SuccessModalProps) => {
  if (!isOpen) return null;

  const handleDownload = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
            <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg leading-6 font-medium text-gray-900">処理が完了しました</h3>
          <div className="mt-2 px-7 py-3">
            <p className="text-sm text-gray-500">{filename}</p>
            <p className="text-xs text-gray-400 mt-1">{(blob.size / 1024).toFixed(1)} KB</p>
          </div>
          <div className="items-center px-4 py-3 space-y-2">
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-green-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-300"
            >
              ダウンロード
            </button>
            {onViewWorkspace && (
              <button
                onClick={onViewWorkspace}
                className="px-4 py-2 bg-blue-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                ワークスペースを開く
              </button>
            )}
            <button
              onClick={() => {
                onClose();
                onNewProcess();
              }}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-base font-medium rounded-md w-full shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              新しい処理を開始
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
