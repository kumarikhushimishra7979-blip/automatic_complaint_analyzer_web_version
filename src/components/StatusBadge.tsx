import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MinusCircle,
  XCircle,
} from 'lucide-react';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case 'Classified':
    case 'Completed':
    case 'Configured':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border border-emerald-200 bg-emerald-50 text-emerald-800 whitespace-nowrap shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    case 'Review':
    case 'Processing':
    case 'Needs Config':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border border-amber-200 bg-amber-50 text-amber-800 whitespace-nowrap shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    case 'Failed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border border-red-200 bg-red-50 text-red-800 whitespace-nowrap shrink-0">
          <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    case 'Pending':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border border-blue-200 bg-blue-50 text-blue-800 whitespace-nowrap shrink-0">
          <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded border border-slate-200 bg-slate-100 text-slate-700 whitespace-nowrap shrink-0">
          <MinusCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
          <span>{status}</span>
        </span>
      );
  }
}
