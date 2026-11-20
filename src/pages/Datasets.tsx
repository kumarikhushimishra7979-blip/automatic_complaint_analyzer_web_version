import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Database,
  Eye,
  Play,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import api, { extractErrorMessage } from '../services/api';
import { formatBytes, formatDateTime, formatNumber } from '../utils/formatters';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorAlert } from '../components/ErrorAlert';

export interface DatasetItem {
  id: number;
  filename: string;
  original_filename: string;
  file_format: string;
  file_size: number;
  total_rows: number;
  uploaded_at: string;
  complaint_column: string | null;
  category_column: string | null;
  active_analysis_id?: number | null;
}

interface PreviewResponse {
  dataset: DatasetItem;
  headers: string[];
  total_rows: number;
  rows: Record<string, string>[];
}

export function Datasets() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [importingSample, setImportingSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Preview & Column Configuration modal/panel state
  const [activeDatasetId, setActiveDatasetId] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedComplaintCol, setSelectedComplaintCol] = useState('');
  const [selectedCategoryCol, setSelectedCategoryCol] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // Delete confirmation & stuck-analysis reset state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [resettingDatasetId, setResettingDatasetId] = useState<number | null>(null);

  const fetchDatasets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: DatasetItem[] }>('/datasets');
      setDatasets(res.data.items);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load datasets.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  const openPreviewAndConfig = async (datasetId: number) => {
    setActiveDatasetId(datasetId);
    setPreviewLoading(true);
    setConfigError(null);
    try {
      const res = await api.get<PreviewResponse>(`/datasets/${datasetId}/preview`);
      setPreviewData(res.data);
      setSelectedComplaintCol(res.data.dataset.complaint_column || '');
      setSelectedCategoryCol(res.data.dataset.category_column || '');
    } catch (err) {
      setConfigError(extractErrorMessage(err, 'Failed to preview dataset.'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSuccessMsg(null);

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
      setError('Unsupported file format. Please select a .csv or .xlsx file.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    try {
      const res = await api.post<{ message: string; dataset: DatasetItem }>(
        '/datasets/upload',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setSuccessMsg(
        `${res.data.dataset.filename} uploaded (${formatNumber(res.data.dataset.total_rows)} rows). Please configure its complaint column.`
      );
      await fetchDatasets();
      await openPreviewAndConfig(res.data.dataset.id);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to upload dataset.'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImportSample = async () => {
    setError(null);
    setSuccessMsg(null);
    setImportingSample(true);
    try {
      const res = await api.post<{ dataset: DatasetItem }>('/datasets/import-sample');
      setSuccessMsg(
        `Sample dataset "${res.data.dataset.filename}" imported (${formatNumber(res.data.dataset.total_rows)} complaints) and pre-configured for analysis.`
      );
      await fetchDatasets();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to import sample dataset.'));
    } finally {
      setImportingSample(false);
    }
  };

  const handleSaveColumns = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDatasetId) return;
    setConfigError(null);

    if (!selectedComplaintCol) {
      setConfigError('Please select the Complaint Text Column.');
      return;
    }
    if (selectedCategoryCol && selectedCategoryCol === selectedComplaintCol) {
      setConfigError('Existing Category Column must be different from Complaint Text Column.');
      return;
    }

    setSavingConfig(true);
    try {
      await api.put(`/datasets/${activeDatasetId}/columns`, {
        complaint_column: selectedComplaintCol,
        category_column: selectedCategoryCol || null,
      });
      setSuccessMsg('Column configuration saved successfully.');
      await fetchDatasets();
      setActiveDatasetId(null);
      setPreviewData(null);
    } catch (err) {
      setConfigError(extractErrorMessage(err, 'Failed to save column configuration.'));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDelete = async (datasetId: number) => {
    setError(null);
    setSuccessMsg(null);
    try {
      await api.delete(`/datasets/${datasetId}`);
      setConfirmDeleteId(null);
      if (activeDatasetId === datasetId) {
        setActiveDatasetId(null);
        setPreviewData(null);
      }
      setSuccessMsg('Dataset deleted successfully.');
      await fetchDatasets();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to delete dataset.'));
      await fetchDatasets();
    }
  };

  const handleResetStuckAnalysis = async (datasetId: number) => {
    setError(null);
    setSuccessMsg(null);
    setResettingDatasetId(datasetId);
    try {
      const res = await api.post<{ message: string; reset_count: number }>(
        `/analyses/dataset/${datasetId}/reset`
      );
      setSuccessMsg(res.data.message);
      setConfirmDeleteId(null);
      await fetchDatasets();
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to reset stuck analysis.'));
    } finally {
      setResettingDatasetId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dataset Management"
        description="Upload customer complaint datasets (.csv or .xlsx), preview records, and map columns before analysis."
        actions={
          <button
            type="button"
            onClick={handleImportSample}
            disabled={importingSample}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {importingSample ? 'Importing Sample...' : 'Load Sample Dataset'}
          </button>
        }
      />

      <ErrorAlert message={error} onDismiss={() => setError(null)} />

      {successMsg && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-800"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Upload Box */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <UploadCloud className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Upload Complaint Dataset
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Accepted formats: CSV (.csv) and Excel (.xlsx) up to 25 MB. Uploaded files are stored privately under your account.
              </p>
            </div>
          </div>

          <div className="shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {uploading ? 'Uploading & Validating...' : 'Select File to Upload'}
            </button>
          </div>
        </div>
      </section>

      {/* Dataset Listing */}
      <section aria-label="Uploaded Datasets">
        {loading ? (
          <LoadingSpinner label="Loading your datasets..." />
        ) : datasets.length === 0 ? (
          <EmptyState
            icon={<Database className="w-5 h-5" />}
            title="No datasets uploaded"
            description="Upload a .csv or .xlsx file above, or click Load Sample Dataset to inspect a ready-to-analyze complaint file."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">Filename</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4 text-right">Total Rows</th>
                    <th className="py-3 px-4">Size</th>
                    <th className="py-3 px-4">Upload Date</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {datasets.map((ds) => (
                    <tr key={ds.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600">
                        #{ds.id}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{ds.filename}</div>
                        {ds.complaint_column && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            Text: <span className="font-mono">{ds.complaint_column}</span>
                            {ds.category_column && (
                              <>
                                {' · '}Category: <span className="font-mono">{ds.category_column}</span>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">
                        {ds.file_format}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {formatNumber(ds.total_rows)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {formatBytes(ds.file_size)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {formatDateTime(ds.uploaded_at)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge
                          status={ds.complaint_column ? 'Configured' : 'Needs Config'}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openPreviewAndConfig(ds.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap shrink-0"
                            title="Preview and configure columns"
                          >
                            {ds.complaint_column ? (
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                            <span>{ds.complaint_column ? 'Preview / Edit' : 'Configure'}</span>
                          </button>

                          {ds.active_analysis_id ? (
                            <button
                              type="button"
                              onClick={() => handleResetStuckAnalysis(ds.id)}
                              disabled={resettingDatasetId === ds.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                              title="Cancel or reset stuck analysis for this dataset"
                            >
                              <span>
                                {resettingDatasetId === ds.id
                                  ? 'Resetting...'
                                  : 'Reset Stuck Analysis'}
                              </span>
                            </button>
                          ) : (
                            ds.complaint_column && (
                              <button
                                type="button"
                                onClick={() => navigate(`/analysis?datasetId=${ds.id}`)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 whitespace-nowrap shrink-0"
                              >
                                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Analyze</span>
                              </button>
                            )
                          )}

                          {confirmDeleteId === ds.id ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDelete(ds.id)}
                                className="px-2 py-1.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 whitespace-nowrap shrink-0"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200 whitespace-nowrap shrink-0"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(ds.id)}
                              aria-label={`Delete dataset ${ds.filename}`}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Preview & Column Configuration Panel */}
      {activeDatasetId !== null && (
        <section
          aria-label="Dataset Preview and Column Configuration"
          className="bg-white border border-slate-200 rounded-lg p-6 space-y-6"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Dataset Preview & Column Configuration
              </h2>
              {previewData && (
                <p className="mt-1 text-xs text-slate-500 font-mono">
                  {previewData.dataset.filename} · Showing first{' '}
                  {previewData.rows.length} of {formatNumber(previewData.total_rows)} rows
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveDatasetId(null);
                setPreviewData(null);
              }}
              aria-label="Close preview"
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <ErrorAlert message={configError} onDismiss={() => setConfigError(null)} />

          {previewLoading ? (
            <LoadingSpinner label="Reading dataset preview..." />
          ) : (
            previewData && (
              <>
                <form
                  onSubmit={handleSaveColumns}
                  className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end bg-slate-50 border border-slate-200 rounded-lg p-4"
                >
                  <div>
                    <label
                      htmlFor="complaint-col"
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      Complaint Text Column (Required)
                    </label>
                    <select
                      id="complaint-col"
                      value={selectedComplaintCol}
                      onChange={(e) => setSelectedComplaintCol(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <option value="">-- Select complaint column --</option>
                      {previewData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="category-col"
                      className="block text-xs font-semibold text-slate-700 mb-1.5"
                    >
                      Existing Category Column (Optional)
                    </label>
                    <select
                      id="category-col"
                      value={selectedCategoryCol}
                      onChange={(e) => setSelectedCategoryCol(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <option value="">None (Prediction-only analysis)</option>
                      {previewData.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={savingConfig}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {savingConfig ? 'Saving...' : 'Save Column Mapping'}
                    </button>
                  </div>
                </form>

                {/* Preview Table */}
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                          <th className="py-2.5 px-3 font-mono">#</th>
                          {previewData.headers.map((h) => (
                            <th key={h} className="py-2.5 px-3 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {previewData.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-mono tabular-nums text-slate-400">
                              {idx + 1}
                            </td>
                            {previewData.headers.map((h) => {
                              const val = row[h];
                              const isEmpty = !val || val.trim() === '';
                              return (
                                <td
                                  key={h}
                                  className="py-2.5 px-3 max-w-xs truncate text-slate-700"
                                  title={val || ''}
                                >
                                  {isEmpty ? (
                                    <span className="text-slate-400 italic">(empty)</span>
                                  ) : (
                                    val
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          )}
        </section>
      )}
    </div>
  );
}
