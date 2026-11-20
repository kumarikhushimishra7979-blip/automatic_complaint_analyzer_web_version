import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, FileSpreadsheet, FileText } from 'lucide-react';
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

interface AnalysisItem {
  id: number;
  dataset_id: number;
  dataset_name: string;
  analysis_status: string;
  total_complaints: number;
  completed_at: string | null;
}

export function Reports() {
  const [completedAnalyses, setCompletedAnalyses] = useState<AnalysisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ items: AnalysisItem[] }>('/analyses', {
        params: { page: 1, page_size: 100 },
      })
      .then((res) => {
        if (active) {
          setCompletedAnalyses(
            res.data.items.filter((a) => a.analysis_status === 'Completed')
          );
        }
      })
      .catch((err) => {
        if (active) setError(extractErrorMessage(err, 'Failed to load available reports.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleDownload = async (analysisId: number, format: 'excel' | 'pdf') => {
    const key = `${analysisId}-${format}`;
    setDownloadingKey(key);
    setError(null);
    try {
      await downloadAuthorizedFile(
        `/reports/${analysisId}/${format}`,
        `complaint_analysis_${analysisId}.${format === 'excel' ? 'xlsx' : 'pdf'}`
      );
    } catch (err) {
      setError(extractErrorMessage(err, `Failed to generate ${format.toUpperCase()} report.`));
    } finally {
      setDownloadingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports & Downloads"
        description="Download formatted Excel workbooks (3 worksheets with formula-injection protection) and Landscape PDF analytical reports for completed analyses."
      />

      <ErrorAlert message={error} onDismiss={() => setError(null)} />

      {loading ? (
        <LoadingSpinner label="Loading completed analysis reports..." />
      ) : completedAnalyses.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet className="w-5 h-5" />}
          title="No reports ready for download"
          description="Only completed analyses can generate Excel and PDF reports. Run an analysis on a dataset first."
          action={
            <Link
              to="/analysis"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Run Complaint Analysis
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
                  <th className="py-3 px-4">Dataset Filename</th>
                  <th className="py-3 px-4 text-right">Total Complaints</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Completed On</th>
                  <th className="py-3 px-4 text-right">Downloads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {completedAnalyses.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                      #{item.id}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {item.dataset_name}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      {formatNumber(item.total_complaints)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={item.analysis_status} />
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {formatDateTime(item.completed_at)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/analysis?analysisId=${item.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Inspect</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDownload(item.id, 'excel')}
                          disabled={downloadingKey !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                          <span>
                            {downloadingKey === `${item.id}-excel` ? 'Building...' : 'Excel (.xlsx)'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownload(item.id, 'pdf')}
                          disabled={downloadingKey !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {downloadingKey === `${item.id}-pdf` ? 'Building...' : 'PDF (.pdf)'}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
