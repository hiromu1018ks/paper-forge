/**
 * 処理中モーダル
 */

interface ProcessingModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  progress?: number;
  stepLabel?: string;
}

export const ProcessingModal = ({
  isOpen,
  title = '処理中...',
  message = 'PDFを処理しています。しばらくお待ちください。',
  progress,
  stepLabel,
}: ProcessingModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
            {typeof progress === 'number' ? (
              <span className="text-blue-600 font-semibold">{Math.floor(progress)}%</span>
            ) : (
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            )}
          </div>
          <h3 className="text-lg leading-6 font-medium text-gray-900">{title}</h3>
          <div className="mt-2 px-7 py-3">
            <p className="text-sm text-gray-500">{message}</p>
            {typeof progress === 'number' && (
              <div className="mt-4 text-left">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
                {stepLabel && <p className="mt-2 text-xs text-gray-500">現在のステップ: {stepLabel}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
