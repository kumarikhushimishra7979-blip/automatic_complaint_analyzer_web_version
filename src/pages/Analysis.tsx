import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Play,
  Search,
  Sparkles,
} from 'lucide-react';
import api, {
  downloadAuthorizedFile,
  extractErrorMessage,
} from '../services/api';
import { formatConfidence, formatNumber } from '../utils/formatters';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';
import { Pagination } from '../components/Pagination';
import {
  CategoryBarChart,
  DistributionPanels,
} from '../components/CategoryBarChart';
import type { DatasetItem } from './Datasets';

interface AnalysisMeta {
  id: number;
  dataset_id: number;
  dataset_name: string;
  analysis_status: 'Pending' | 'Processing' | 'Completed' | 'Failed';
  total_complaints: number;
  processed_complaints: number;
  progress_percent: number;
  confidence_threshold: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface AnalysisStats {
  analysis_id: number;
  dataset_id: number;
  dataset_name: string;
  analysis_status: string;
  confidence_threshold: number;
  total_complaints: number;
  classified_count: number;
  review_count: number;
  empty_count: number;
  eligible_complaints: number;
  predicted_categories_count: number;
  candidate_groups_count: number;
  top3_categories_count: number;
  top3_categories_share: number;
  percentage_denominator_note: string;
  category_summary: { rank: number; category: string; count: number; percentage: number }[];
  status_distribution: { status: string; count: number; percentage: number }[];
  review_distribution: { label: string; count: number; percentage: number }[];
  candidate_groups: {
    group_name: string;
    count: number;
    sample_complaints: string[];
  }[];
}

interface ResultRow {
  id: number;
  row_index: number;
  complaint_text: string;
  existing_category: string | null;
  predicted_category: string | null;
  confidence_score: number;
  classification_status: string;
  needs_review: number;
  candidate_group: string | null;
}

interface ResultsResponse {
  items: ResultRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function Analysis() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDatasetId = searchParams.get('datasetId') || '';
  const initialAnalysisId = searchParams.get('analysisId');

  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(initialDatasetId);
  const [threshold, setThreshold] = useState<string>('0.40');
  const [starting, setStarting] = useState(false);

  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisMeta | null>(null);
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);

  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'excel' | 'pdf' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [reviewFilter, setReviewFilter] = useState('ALL');
  const [groupFilter, setGroupFilter] = useState('ALL');

  const loadAnalysisDetails = useCallback(async (analysisId: number) => {
    const res = await api.get<AnalysisMeta>(`/analyses/${analysisId}`);
    setActiveAnalysis(res.data);
    return res.data;
  }, []);

  const loadStats = useCallback(async (analysisId: number) => {
    const res = await api.get<AnalysisStats>(`/analyses/${analysisId}/statistics`);
    setStats(res.data);
  }, []);

  const loadResults = useCallback(
    async (analysisId: number) => {
      setLoadingResults(true);
      try {
        const res = await api.get<ResultsResponse>(`/analyses/${analysisId}/results`, {
          params: {
            page,
            page_size: pageSize,
            search: searchQuery || undefined,
            category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
            status: statusFilter !== 'ALL' ? statusFilter : undefined,
            needs_review: reviewFilter !== 'ALL' ? reviewFilter : undefined,
            candidate_group: groupFilter !== 'ALL' ? groupFilter : undefined,
          },
        });
        setResults(res.data);
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to load analysis results.'));
      } finally {
        setLoadingResults(false);
      }
    },
    [page, pageSize, searchQuery, categoryFilter, statusFilter, reviewFilter, groupFilter]
  );

  useEffect(() => {
    let active = true;
    async function init() {
      setLoadingInit(true);
      try {
        const dsRes = await api.get<{ items: DatasetItem[] }>('/datasets');
        if (!active) return;
        setDatasets(dsRes.data.items);

        if (initialAnalysisId) {
          const meta = await loadAnalysisDetails(Number(initialAnalysisId));
          if (!active) return;
          if (meta.analysis_status === 'Completed') {
            await loadStats(meta.id);
          }
        } else if (!initialDatasetId) {
          // Pick first configured dataset if available
          const firstConfigured = dsRes.data.items.find((d) => d.complaint_column);
          if (firstConfigured) setSelectedDatasetId(String(firstConfigured.id));
        }
      } catch (err) {
        if (active) setError(extractErrorMessage(err, 'Failed to initialize analysis view.'));
      } finally {
        if (active) setLoadingInit(false);
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [initialAnalysisId, initialDatasetId, loadAnalysisDetails, loadStats]);

  // Poll progress while Pending or Processing
  useEffect(() => {
    const analysisId = activeAnalysis?.id;
    const status = activeAnalysis?.analysis_status;
    if (!analysisId || (status !== 'Pending' && status !== 'Processing')) {
      return;
    }

    let consecutiveErrors = 0;
    const timer = window.setInterval(async () => {
      try {
        const res = await api.get<{
          analysis_id: number;
          analysis_status: AnalysisMeta['analysis_status'];
          total_complaints: number;
          processed_complaints: number;
          progress_percent: number;
          error_message: string | null;
        }>(`/analyses/${analysisId}/progress`);

        consecutiveErrors = 0;
        setActiveAnalysis((prev) =>
          prev
            ? {
                ...prev,
                analysis_status: res.data.analysis_status,
                total_complaints: res.data.total_complaints,
                processed_complaints: res.data.processed_complaints,
                progress_percent: res.data.progress_percent,
                error_message: res.data.error_message,
              }
            : prev
        );

        if (res.data.analysis_status === 'Completed') {
          window.clearInterval(timer);
          await loadStats(analysisId);
        } else if (res.data.analysis_status === 'Failed') {
          window.clearInterval(timer);
          setError(res.data.error_message || 'Analysis execution failed.');
        }
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          window.clearInterval(timer);
          setError(extractErrorMessage(err, 'Lost connection while tracking analysis progress.'));
        }
      }
    }, 600);

    return () => window.clearInterval(timer);
  }, [activeAnalysis?.id, activeAnalysis?.analysis_status, loadStats]);

  // Load paginated results whenever completed analysis or filters change
  useEffect(() => {
    if (activeAnalysis && activeAnalysis.analysis_status === 'Completed') {
      loadResults(activeAnalysis.id);
    }
  }, [activeAnalysis?.id, activeAnalysis?.analysis_status, loadResults]);

  const handleRunAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedDatasetId) {
      setError('Please select a configured dataset to analyze.');
      return;
    }

    const parsedThreshold = Number(threshold);
    if (Number.isNaN(parsedThreshold) || parsedThreshold < 0.1 || parsedThreshold > 0.9) {
      setError('Confidence threshold must be between 0.10 and 0.90.');
      return;
    }

    setStarting(true);
    try {
      const res = await api.post<{ analysis: AnalysisMeta }>(
        `/analyses/${selectedDatasetId}/run`,
        { confidence_threshold: parsedThreshold }
      );
      const started = res.data.analysis;
      setStats(null);
      setResults(null);
      setPage(1);
      setCategoryFilter('ALL');
      setStatusFilter('ALL');
      setReviewFilter('ALL');
      setGroupFilter('ALL');
      setSearchQuery('');
      setActiveAnalysis(started);
      setSearchParams({ analysisId: String(started.id) });
    } catch (err) {
      setError(extractErrorMessage(err, 'Unable to start complaint analysis.'));
    } finally {
      setStarting(false);
    }
  };

  const handleDownload = async (format: 'excel' | 'pdf') => {
    if (!activeAnalysis) return;
    setDownloadingFormat(format);
    setError(null);
    try {
      await downloadAuthorizedFile(
        `/reports/${activeAnalysis.id}/${format}`,
        `complaint_analysis_${activeAnalysis.id}.${format === 'excel' ? 'xlsx' : 'pdf'}`
      );
    } catch (err) {
      setError(extractErrorMessage(err, `Failed to download ${format.toUpperCase()} report.`));
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleCancelActiveAnalysis = async () => {
    if (!activeAnalysis) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await api.post<{ analysis: AnalysisMeta }>(
        `/analyses/${activeAnalysis.id}/cancel`
      );
      setActiveAnalysis(res.data.analysis);
      setError('Analysis was cancelled and reset. You can re-run or delete the dataset.');
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to cancel analysis.'));
    } finally {
      setCancelling(false);
    }
  };

  const handleResetStuckForSelected = async () => {
    if (!selectedDatasetId) return;
    setCancelling(true);
    try {
      await api.post(`/analyses/dataset/${selectedDatasetId}/reset`);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to reset stuck analysis.'));
    } finally {
      setCancelling(false);
    }
  };

  const configuredDatasets = datasets.filter((d) => Boolean(d.complaint_column));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaint Analysis"
        description="Run local machine learning classification, detect low-confidence reviews, and discover emerging complaint groups."
        actions={
          activeAnalysis?.analysis_status === 'Completed' ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownload('excel')}
                disabled={downloadingFormat !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                <span>{downloadingFormat === 'excel' ? 'Generating...' : 'Download Excel'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownload('pdf')}
                disabled={downloadingFormat !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <FileText className="w-4 h-4" aria-hidden="true" />
                <span>{downloadingFormat === 'pdf' ? 'Generating...' : 'Download PDF'}</span>
              </button>
            </div>
          ) : undefined
        }
      />

      <ErrorAlert message={error} onDismiss={() => setError(null)} />
      {error && error.includes('already in progress') && selectedDatasetId && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleResetStuckForSelected}
            disabled={cancelling}
            className="px-3.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded-md hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {cancelling ? 'Resetting...' : 'Reset Stuck Analysis for This Dataset'}
          </button>
        </div>
      )}

      {/* Launch Configuration Card */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        {loadingInit ? (
          <LoadingSpinner label="Loading datasets..." />
        ) : configuredDatasets.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="w-5 h-5" />}
            title="No configured datasets available"
            description="Upload a dataset and configure its complaint text column in Dataset Management before running an automatic analysis."
            action={
              <Link
                to="/datasets"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Configure a Dataset
              </Link>
            }
          />
        ) : (
          <form onSubmit={handleRunAnalysis} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-6">
              <label htmlFor="dataset-select" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Select Configured Dataset
              </label>
              <select
                id="dataset-select"
                value={selectedDatasetId}
                onChange={(e) => setSelectedDatasetId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <option value="">-- Choose a dataset --</option>
                {configuredDatasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    #{ds.id} · {ds.filename} ({formatNumber(ds.total_rows)} rows · Col: {ds.complaint_column})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label htmlFor="threshold-input" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Review Confidence Threshold
              </label>
              <input
                id="threshold-input"
                type="number"
                step="0.05"
                min="0.10"
                max="0.90"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
            </div>

            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={starting || !selectedDatasetId}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>{starting ? 'Initiating...' : 'Run Automatic Analysis'}</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Progress Tracker */}
      {activeAnalysis &&
        (activeAnalysis.analysis_status === 'Pending' ||
          activeAnalysis.analysis_status === 'Processing') && (
          <section className="bg-white border border-slate-200 rounded-lg p-6">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Analyzing {activeAnalysis.dataset_name} (Analysis #{activeAnalysis.id})
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Processing complaint batches with local ML classifier and KMeans clustering...
                </p>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <StatusBadge status={activeAnalysis.analysis_status} />
                <button
                  type="button"
                  onClick={handleCancelActiveAnalysis}
                  disabled={cancelling}
                  className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {cancelling ? 'Cancelling...' : 'Cancel / Reset'}
                </button>
              </div>
            </div>

            <div className="w-full h-2.5 bg-slate-100 rounded overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-200"
                style={{ width: `${Math.max(4, activeAnalysis.progress_percent)}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-mono tabular-nums text-slate-600">
              <span>
                Processed {formatNumber(activeAnalysis.processed_complaints)} /{' '}
                {formatNumber(activeAnalysis.total_complaints)} rows
              </span>
              <span>{activeAnalysis.progress_percent.toFixed(0)}%</span>
            </div>
          </section>
        )}

      {/* Completed Statistical Dashboard & Results */}
      {activeAnalysis && activeAnalysis.analysis_status === 'Completed' && stats && (
        <div className="space-y-6">
          {/* Executive Customer Complaint Categorization Report Header Card */}
          <section
            aria-label="Executive Categorization Report Summary"
            className="bg-white border border-slate-200 rounded-lg overflow-hidden"
          >
            <div className="bg-[#17324D] px-6 py-4 text-center">
              <h2 className="text-lg font-bold tracking-tight text-white">
                Customer Complaint Categorization Report
              </h2>
            </div>
            <div className="bg-[#F2F6FA] border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
              <span className="italic font-medium">
                Based on {formatNumber(stats.eligible_complaints)} non-empty complaint entries
              </span>
              <div className="flex flex-wrap items-center gap-2 text-slate-600">
                <span className="font-semibold text-slate-900">
                  Analysis #{activeAnalysis.id}
                </span>
                <span aria-hidden="true">·</span>
                <span>{stats.dataset_name}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Threshold {(stats.confidence_threshold * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200">
              <div className="px-5 py-3.5 bg-[#DCE6F1]/55 flex items-center justify-between gap-4">
                <span className="text-xs font-semibold text-[#17324D]">
                  Total complaints
                </span>
                <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
                  {formatNumber(stats.eligible_complaints)}
                </span>
              </div>
              <div className="px-5 py-3.5 bg-[#DCE6F1]/55 flex items-center justify-between gap-4">
                <span className="text-xs font-semibold text-[#17324D]">
                  Top 3 categories (count)
                </span>
                <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
                  {formatNumber(stats.top3_categories_count)}
                </span>
              </div>
              <div className="px-5 py-3.5 bg-[#DCE6F1]/55 flex items-center justify-between gap-4">
                <span className="text-xs font-semibold text-[#17324D]">
                  Top 3 categories (share)
                </span>
                <span className="text-xl font-bold font-mono tabular-nums text-slate-900">
                  {stats.top3_categories_share.toFixed(1)}%
                </span>
              </div>
            </div>
          </section>

          {/* Processing Breakdown Stat Cards */}
          <section aria-label="Analysis Processing Statistics">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard label="Total Processed" value={stats.total_complaints} />
              <StatCard
                label="Classified"
                value={stats.classified_count}
                tone="success"
              />
              <StatCard
                label="Review Required"
                value={stats.review_count}
                tone="warning"
              />
              <StatCard label="Empty Text" value={stats.empty_count} />
              <StatCard
                label="Predicted Categories"
                value={stats.predicted_categories_count}
              />
              <StatCard
                label="Candidate Groups"
                value={stats.candidate_groups_count}
              />
            </div>
          </section>

          {/* Category-wise Summary Table (left) & Multi-Color Bar Chart (right) */}
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
            <div className="xl:col-span-6 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">
                  Category-wise Summary
                </h3>
                <span className="text-xs text-slate-500">
                  Sorted by Complaint Count
                </span>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#17324D] text-white text-xs font-semibold">
                      <th className="py-2.5 px-3">Issue Type</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">
                        Complaint Count
                      </th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap min-w-[140px]">
                        Percentage
                      </th>
                      <th className="py-2.5 px-3 text-center w-14">Rank</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {[...stats.category_summary]
                      .sort((a, b) => b.count - a.count)
                      .map((row, idx) => {
                        const maxPct = Math.max(
                          1,
                          ...stats.category_summary.map((c) => c.percentage)
                        );
                        const relPct = Math.min(
                          100,
                          Math.max(4, (row.percentage / maxPct) * 100)
                        );
                        return (
                          <tr
                            key={row.category}
                            className={
                              idx % 2 === 0
                                ? 'bg-white hover:bg-slate-50'
                                : 'bg-[#F2F6FA] hover:bg-slate-100/70'
                            }
                          >
                            <td className="py-2 px-3 font-medium text-slate-800">
                              {row.category}
                            </td>
                            <td className="py-2 px-3 text-center font-mono tabular-nums text-slate-800 whitespace-nowrap">
                              {formatNumber(row.count)}
                            </td>
                            <td className="py-1.5 px-3 relative min-w-[140px]">
                              <div className="relative h-6 flex items-center justify-end px-1.5">
                                {row.percentage > 0 && (
                                  <div
                                    className="absolute left-0 top-0.5 bottom-0.5 rounded-r-sm pointer-events-none"
                                    style={{
                                      width: `${relPct}%`,
                                      background:
                                        'linear-gradient(90deg, rgba(43, 91, 132, 0.72) 0%, rgba(79, 129, 189, 0.22) 100%)',
                                    }}
                                    aria-hidden="true"
                                  />
                                )}
                                <span className="relative z-10 font-mono tabular-nums font-semibold text-slate-900">
                                  {row.percentage.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-center font-mono tabular-nums font-semibold text-slate-700">
                              {row.rank ?? idx + 1}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#DCE6F1] border-t-2 border-[#17324D] text-xs font-bold text-slate-900">
                      <td className="py-2.5 px-3">TOTAL</td>
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                        {formatNumber(stats.eligible_complaints)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {stats.eligible_complaints > 0 ? '100.0%' : '0.0%'}
                      </td>
                      <td className="py-2.5 px-3 text-center" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="xl:col-span-6">
              <CategoryBarChart
                data={stats.category_summary}
                denominatorNote={stats.percentage_denominator_note}
              />
            </div>
          </section>

          <DistributionPanels
            statusDistribution={stats.status_distribution}
            reviewDistribution={stats.review_distribution}
          />

          {/* Potential New Complaint Group Discovery */}
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600" aria-hidden="true" />
                  <span>Potential New Complaint Group Discovery</span>
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  Clustered suggestions from low-confidence complaints via KMeans and cosine similarity. Candidate groups require human verification before official category approval.
                </p>
              </div>
            </div>

            {stats.candidate_groups.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">
                No cohesive emerging complaint clusters met the minimum cluster size in this dataset.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {stats.candidate_groups.map((grp) => (
                  <div
                    key={grp.group_name}
                    className="border border-slate-200 rounded-lg p-4 bg-slate-50/60 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-900">
                          {grp.group_name}
                        </h4>
                        <span className="font-mono tabular-nums text-xs font-medium text-slate-700 shrink-0">
                          {grp.count} items
                        </span>
                      </div>
                      <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600">
                        {grp.sample_complaints.map((txt, i) => (
                          <li key={i} className="truncate" title={txt}>
                            • {txt}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setGroupFilter(grp.group_name);
                        setPage(1);
                      }}
                      className="mt-3 text-left text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      Filter table by this group →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Filterable & Paginated Results Table */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Filter className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <span>Detailed Classification Results</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownload('excel')}
                    disabled={downloadingFormat !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload('pdf')}
                    disabled={downloadingFormat !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>PDF</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden="true" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search complaint text..."
                    className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  />
                </div>

                <select
                  aria-label="Filter by predicted category"
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <option value="ALL">All Predicted Categories</option>
                  {stats.category_summary.map((c) => (
                    <option key={c.category} value={c.category}>
                      {c.category}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by classification status"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Classified">Classified</option>
                  <option value="Review">Review</option>
                  <option value="Empty Text">Empty Text</option>
                </select>

                <select
                  aria-label="Filter by review requirement"
                  value={reviewFilter}
                  onChange={(e) => {
                    setReviewFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <option value="ALL">All Review States</option>
                  <option value="true">Review Required Only</option>
                  <option value="false">No Review Required</option>
                </select>

                <select
                  aria-label="Filter by candidate group"
                  value={groupFilter}
                  onChange={(e) => {
                    setGroupFilter(e.target.value);
                    setPage(1);
                  }}
                  className="px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <option value="ALL">All Candidate Groups</option>
                  <option value="ANY_GROUP">Any Candidate Group</option>
                  {stats.candidate_groups.map((g) => (
                    <option key={g.group_name} value={g.group_name}>
                      {g.group_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loadingResults ? (
              <LoadingSpinner label="Loading filtered results..." />
            ) : !results || results.items.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                No complaint rows match the selected filters.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4 whitespace-nowrap">S/N</th>
                        <th className="py-3 px-4 min-w-[280px]">Complaint Description</th>
                        <th className="py-3 px-4 whitespace-nowrap">Predicted Category</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Confidence</th>
                        <th className="py-3 px-4 whitespace-nowrap">Status</th>
                        <th className="py-3 px-4 whitespace-nowrap">Candidate Group</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {results.items.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70 align-top">
                          <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500">
                            {row.row_index}
                          </td>
                          <td className="py-3 px-4 text-slate-800 max-w-md">
                            {row.complaint_text && row.complaint_text.trim() ? (
                              row.complaint_text
                            ) : (
                              <span className="italic text-slate-400">
                                (Empty complaint description)
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-800 font-medium min-w-[200px] max-w-[280px]">
                            {row.predicted_category || '-'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                            {row.classification_status === 'Empty Text'
                              ? '-'
                              : formatConfidence(row.confidence_score)}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge status={row.classification_status} />
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                            {row.candidate_group ? (
                              <span className="font-medium text-blue-700">
                                {row.candidate_group}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  page={results.page}
                  pageSize={results.page_size}
                  total={results.total}
                  totalPages={results.total_pages}
                  onPageChange={(next) => setPage(next)}
                  onPageSizeChange={(nextSize) => {
                    setPageSize(nextSize);
                    setPage(1);
                  }}
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
