import { formatNumber } from '../utils/formatters';

interface StatCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

export function StatCard({ label, value, subtitle, tone = 'default' }: StatCardProps) {
  const valueToneClass =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'warning'
      ? 'text-amber-700'
      : tone === 'danger'
      ? 'text-red-700'
      : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <p className="text-xs font-medium text-slate-500 tracking-wide">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold font-mono tabular-nums tracking-tight ${valueToneClass}`}
      >
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
      {subtitle && <p className="mt-1.5 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}
