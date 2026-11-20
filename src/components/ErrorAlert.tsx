import { AlertCircle, X } from 'lucide-react';

interface ErrorAlertProps {
  message: string | null;
  onDismiss?: () => void;
}

export function ErrorAlert({ message, onDismiss }: ErrorAlertProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="text-red-500 hover:text-red-700 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
