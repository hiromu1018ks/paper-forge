/**
 * 処理中モーダル
 */

interface ProcessingModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
}

export const ProcessingModal = ({ isOpen, title = '処理中...', message = 'PDFを処理しています。しばらくお待ちください。' }: ProcessingModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3 text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
          <h3 className="text-lg leading-6 font-medium text-gray-900">{title}</h3>
          <div className="mt-2 px-7 py-3">
            <p className="text-sm text-gray-500">{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
