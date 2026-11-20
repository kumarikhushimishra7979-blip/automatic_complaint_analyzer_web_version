import { formatNumber } from '../utils/formatters';

interface CategoryItem {
  rank?: number;
  category: string;
  count: number;
  percentage: number;
}

interface StatusItem {
  status: string;
  count: number;
  percentage: number;
}

interface ReviewItem {
  label: string;
  count: number;
  percentage: number;
}

export const EXECUTIVE_CHART_COLORS = [
  '#2B5B84', // navy blue
  '#9E3B33', // dark red
  '#77933C', // olive green
  '#604A7B', // purple
  '#31859C', // teal
  '#C56A28', // burnt orange
  '#4F81BD', // royal blue
  '#C0504D', // crimson
  '#9BBB59', // sage
  '#8064A2', // violet
  '#4BACC6', // cyan
  '#F79646', // peach
  '#D99694', // soft rose
  '#95B3D7', // soft blue
] as const;

export function CategoryBarChart({
  data,
  denominatorNote,
}: {
  data: CategoryItem[];
  denominatorNote: string;
}) {
  if (data.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
        No non-empty complaint categories were predicted in this analysis.
      </div>
    );
  }

  const rawMax = Math.max(1, ...data.map((d) => d.count));
  const axisMax = Math.max(4, Math.ceil(rawMax / 4) * 4);
  const ticks = [0, 1, 2, 3, 4].map((t) => Math.round((axisMax * t) / 4));

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between h-full">
      <div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-900">
            Complaints by Issue Type
          </h3>
          <span className="text-xs text-slate-500">Multi-category breakdown</span>
        </div>

        <div
          className="relative"
          role="img"
          aria-label="Horizontal bar chart titled Complaints by Issue Type with vertical gridlines"
        >
          {/* Bar rows with vertical gridlines */}
          <div className="space-y-2.5">
            {data.map((item, idx) => {
              const barColor =
                EXECUTIVE_CHART_COLORS[idx % EXECUTIVE_CHART_COLORS.length];
              const widthPct =
                item.count > 0
                  ? Math.max(1.5, Math.min(100, (item.count / axisMax) * 100))
                  : 0;

              return (
                <div
                  key={item.category}
                  className="grid grid-cols-12 items-center gap-2.5"
                >
                  <div
                    className="col-span-4 text-xs font-medium text-slate-700 truncate text-right pr-1"
                    title={item.category}
                  >
                    {item.category}
                  </div>
                  <div className="col-span-5 relative h-6 flex items-center">
                    {/* Vertical gridlines inside bar plotting area */}
                    <div
                      className="absolute inset-0 flex justify-between pointer-events-none"
                      aria-hidden="true"
                    >
                      {ticks.map((tick, tIdx) => (
                        <div
                          key={tick}
                          className={`h-full ${
                            tIdx === 0
                              ? 'border-l border-slate-400'
                              : 'border-l border-slate-200'
                          }`}
                        />
                      ))}
                    </div>

                    {/* Colored horizontal bar */}
                    {widthPct > 0 && (
                      <div
                        className="relative z-10 h-4 rounded-r-sm transition-all duration-200"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: barColor,
                        }}
                      />
                    )}
                  </div>
                  <div className="col-span-3 text-left font-mono tabular-nums text-xs font-semibold text-slate-800 whitespace-nowrap">
                    {formatNumber(item.count)} ({item.percentage.toFixed(1)}%)
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-axis tick labels aligned under bar track */}
          <div className="grid grid-cols-12 gap-2.5 mt-2 pt-1.5 border-t border-slate-200">
            <div className="col-span-4" />
            <div className="col-span-5 flex justify-between text-[11px] font-mono tabular-nums text-slate-500">
              {ticks.map((tick) => (
                <span key={tick}>{formatNumber(tick)}</span>
              ))}
            </div>
            <div className="col-span-3" />
          </div>
          <div className="grid grid-cols-12 gap-2.5 mt-0.5">
            <div className="col-span-4" />
            <div className="col-span-5 text-center text-[11px] font-semibold text-slate-600">
              Number of Complaints
            </div>
            <div className="col-span-3" />
          </div>
        </div>
      </div>

      <p className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
        {denominatorNote}
      </p>
    </div>
  );
}

export function DistributionPanels({
  statusDistribution,
  reviewDistribution,
}: {
  statusDistribution: StatusItem[];
  reviewDistribution: ReviewItem[];
}) {
  const statusColor = (status: string) => {
    if (status === 'Classified') return 'bg-emerald-600';
    if (status === 'Review') return 'bg-amber-500';
    return 'bg-slate-400';
  };

  const reviewColor = (label: string) => {
    if (label.includes('Manual Review')) return 'bg-amber-500';
    return 'bg-blue-600';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-4">
          Classification Status Distribution
        </h3>
        <div className="w-full h-3 bg-slate-100 rounded overflow-hidden flex mb-4">
          {statusDistribution.map((s) =>
            s.percentage > 0 ? (
              <div
                key={s.status}
                className={statusColor(s.status)}
                style={{ width: `${s.percentage}%` }}
                title={`${s.status}: ${s.count} (${s.percentage.toFixed(1)}%)`}
              />
            ) : null
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {statusDistribution.map((s) => (
            <div key={s.status} className="py-2.5 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-sm ${statusColor(s.status)}`} aria-hidden="true" />
                <span className="text-slate-700 font-medium">{s.status}</span>
              </div>
              <span className="font-mono tabular-nums text-xs text-slate-700">
                {formatNumber(s.count)} · {s.percentage.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="text-base font-semibold text-slate-900 mb-4">
          Review-Required Complaint Distribution
        </h3>
        <div className="w-full h-3 bg-slate-100 rounded overflow-hidden flex mb-4">
          {reviewDistribution.map((r) =>
            r.percentage > 0 ? (
              <div
                key={r.label}
                className={reviewColor(r.label)}
                style={{ width: `${r.percentage}%` }}
                title={`${r.label}: ${r.count} (${r.percentage.toFixed(1)}%)`}
              />
            ) : null
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {reviewDistribution.map((r) => (
            <div key={r.label} className="py-2.5 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-sm ${reviewColor(r.label)}`} aria-hidden="true" />
                <span className="text-slate-700 font-medium">{r.label}</span>
              </div>
              <span className="font-mono tabular-nums text-xs text-slate-700">
                {formatNumber(r.count)} · {r.percentage.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
