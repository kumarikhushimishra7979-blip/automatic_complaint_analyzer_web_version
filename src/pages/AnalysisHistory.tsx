import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, FileSpreadsheet, FileText, History } from 'lucide-react';
import api, {
  downloadAuthorizedFile,
  extractErrorMessage,
} from '../services/api';
import { formatDateTime, formatNumber } from '../utils/formatters';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { Pagination } from '../components/Pagination';

interface AnalysisHistoryItem {
  id: number;
  dataset_id: number;
  dataset_name: string;
  analysis_status: string;
  total_complaints: number;
  processed_complaints: number;
  progress_percent: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface HistoryResponse {
  items: AnalysisHistoryItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function AnalysisHistory() {
  const navigate = useNavigate();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HistoryResponse>('/analyses', {
        params: { page, page_size: pageSize },
      });
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load analysis history.'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleDownload = async (analysisId: number, format: 'excel' | 'pdf') => {
    setError(null);
    try {
      await downloadAuthorizedFile(
        `/reports/${analysisId}/${format}`,
        `complaint_analysis_${analysisId}.${format === 'excel' ? 'xlsx' : 'pdf'}`
      );
    } catch (err) {
      setError(extractErrorMessage(err, `Failed to download ${format.toUpperCase()} report.`));
    }
  };

  const handleCancelAnalysis = async (analysisId: number) => {
    setError(null);
    setCancellingId(analysisId);
    try {
      await api.post(`/analyses/${analysisId}/cancel`);
      await fetchHistory();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to cancel stuck analysis.'));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analysis History"
        description="Track active complaint analyses, inspect completed runs, and review any failed jobs."
        actions={
          <Link
            to="/analysis"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            New Analysis
          </Link>
        }
      />

      <ErrorAlert message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <LoadingSpinner label="Loading analysis history..." />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<History className="w-5 h-5" />}
          title="No analyses recorded yet"
          description="Run your first complaint analysis on a configured dataset to view progress, statistics, and downloadable reports here."
          action={
            <Link
              to="/analysis"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Go to Complaint Analysis
            </Link>
          }
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Analysis ID</th>
                  <th className="py-3 px-4">Dataset Name</th>
                  <th className="py-3 px-4 text-right">Total Complaints</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Started Date</th>
                  <th className="py-3 px-4">Completed Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                      #{item.id}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{item.dataset_name}</div>
                      {item.error_message && (
                        <div className="text-xs text-red-600 mt-0.5">{item.error_message}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {formatNumber(item.total_complaints)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={item.analysis_status} />
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {formatDateTime(item.started_at)}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {formatDateTime(item.completed_at)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/analysis?analysisId=${item.id}`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {item.analysis_status === 'Processing' ||
                            item.analysis_status === 'Pending'
                              ? 'Track Progress'
                              : 'View Results'}
                          </span>
                        </button>

                        {(item.analysis_status === 'Pending' ||
                          item.analysis_status === 'Processing') && (
                          <button
                            type="button"
                            onClick={() => handleCancelAnalysis(item.id)}
                            disabled={cancellingId === item.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <span>
                              {cancellingId === item.id ? 'Resetting...' : 'Cancel / Reset'}
                            </span>
                          </button>
                        )}

                        {item.analysis_status === 'Completed' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDownload(item.id, 'excel')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                              title="Download Excel report"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                              <span>Excel</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownload(item.id, 'pdf')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                              title="Download PDF report"
                            >
                              <FileText className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                              <span>PDF</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={data.page}
            pageSize={data.page_size}
            total={data.total}
            totalPages={data.total_pages}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}
