import { useEffect } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastProps {
  id: string;
  message: string;
  variant?: ToastVariant;
  onDismiss?: (id: string) => void;
  duration?: number;
}

const variantStyles: Record<ToastVariant, string> = {
  success: 'bg-emerald-500 text-white',
  error: 'bg-red-500 text-white',
  info: 'bg-slate-700 text-white',
};

export const Toast = ({ id, message, variant = 'info', onDismiss, duration = 4000 }: ToastProps) => {
  useEffect(() => {
    if (!onDismiss || duration <= 0) return;
    const timer = window.setTimeout(() => {
      onDismiss(id);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, id, onDismiss]);

  return (
    <div className={`pointer-events-auto flex min-w-[240px] items-start gap-3 rounded-md px-4 py-3 shadow-lg ${variantStyles[variant]}`}>
      <div className="flex-1 text-sm leading-5">{message}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(id)}
          className="text-sm font-medium opacity-80 transition-opacity hover:opacity-100"
          aria-label="通知を閉じる"
        >
          ×
        </button>
      )}
    </div>
  );
};
