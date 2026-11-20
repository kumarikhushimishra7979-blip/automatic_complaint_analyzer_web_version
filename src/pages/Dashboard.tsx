import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Database,
  FileSpreadsheet,
  History,
} from 'lucide-react';
import api, { extractErrorMessage } from '../services/api';
import { formatDateTime, formatNumber } from '../utils/formatters';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';

interface DashboardSummary {
  total_datasets: number;
  total_complaints_uploaded: number;
  completed_analyses: number;
  available_reports: number;
  processing_analyses: number;
  failed_analyses: number;
  recent_datasets: {
    id: number;
    filename: string;
    total_rows: number;
    uploaded_at: string;
    file_format: string;
    complaint_column: string | null;
  }[];
}

export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<DashboardSummary>('/dashboard/summary')
      .then((res) => {
        if (active) setSummary(res.data);
      })
      .catch((err) => {
        if (active) setError(extractErrorMessage(err, 'Failed to load dashboard metrics.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const quickActions = [
    {
      title: 'Manage Datasets',
      description: 'Upload .csv or .xlsx complaint datasets, preview rows, and map columns.',
      to: '/datasets',
      icon: Database,
    },
    {
      title: 'Analyze Complaints',
      description: 'Run local ML classification and discover emerging complaint clusters.',
      to: '/analysis',
      icon: BarChart3,
    },
    {
      title: 'Analysis History',
      description: 'Review past analysis runs, track progress, and inspect results.',
      to: '/history',
      icon: History,
    },
    {
      title: 'Reports and Downloads',
      description: 'Export completed analyses as formatted Excel workbooks and PDF reports.',
      to: '/reports',
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Overview of your uploaded complaint datasets, active analyses, and downloadable reports."
        actions={
          <Link
            to="/analysis"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Analyze Complaints
          </Link>
        }
      />

      <ErrorAlert message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <LoadingSpinner label="Loading workspace overview..." />
      ) : (
        <>
          {/* Statistics Strip */}
          <section aria-label="Workspace Statistics">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Uploaded Datasets"
                value={summary?.total_datasets ?? 0}
                subtitle="Owned by your account"
              />
              <StatCard
                label="Total Complaints Uploaded"
                value={summary?.total_complaints_uploaded ?? 0}
                subtitle="Rows across all datasets"
              />
              <StatCard
                label="Completed Analyses"
                value={summary?.completed_analyses ?? 0}
                tone="success"
                subtitle={
                  summary && summary.processing_analyses > 0
                    ? `${summary.processing_analyses} currently processing`
                    : 'Ready for inspection'
                }
              />
              <StatCard
                label="Available Reports"
                value={summary?.available_reports ?? 0}
                subtitle={
                  summary && summary.failed_analyses > 0
                    ? `${summary.failed_analyses} failed runs logged`
                    : 'Excel & PDF formats'
                }
              />
            </div>
          </section>

          {/* Quick Actions */}
          <section aria-label="Quick Actions">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Quick Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.to}
                    to={action.to}
                    className="group bg-white border border-slate-200 rounded-lg p-5 hover:border-blue-300 transition-colors flex flex-col justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <div>
                      <div className="w-9 h-9 rounded-md bg-slate-100 text-slate-700 group-hover:bg-blue-50 group-hover:text-blue-600 flex items-center justify-center transition-colors">
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <h3 className="mt-3.5 text-sm font-semibold text-slate-900">
                        {action.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                        {action.description}
                      </p>
                    </div>
                    <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-blue-600">
                      <span>Open</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Recent Datasets Table */}
          <section aria-label="Recent Datasets">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-900">Recent Datasets</h2>
              <Link
                to="/datasets"
                className="text-sm font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
              >
                View All
              </Link>
            </div>

            {!summary || summary.recent_datasets.length === 0 ? (
              <EmptyState
                icon={<Database className="w-5 h-5" />}
                title="No datasets uploaded yet"
                description="Upload a CSV or Excel dataset containing customer complaints—or import the built-in sample dataset—to run your first analysis."
                action={
                  <Link
                    to="/datasets"
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Go to Dataset Management
                  </Link>
                }
              />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Dataset Name</th>
                        <th className="py-3 px-4 text-right">Total Rows</th>
                        <th className="py-3 px-4">Upload Date</th>
                        <th className="py-3 px-4">File Format</th>
                        <th className="py-3 px-4">Configuration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {summary.recent_datasets.map((ds) => (
                        <tr key={ds.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-medium text-slate-900">
                            {ds.filename}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                            {formatNumber(ds.total_rows)}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                            {formatDateTime(ds.uploaded_at)}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600">
                            {ds.file_format}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge
                              status={ds.complaint_column ? 'Configured' : 'Needs Config'}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
