import fs from 'fs';
import path from 'path';
import { getDb } from '../database.ts';
import { config } from '../config.ts';
import {
  assertPathInsideDirectory,
  buildSecureStoragePath,
  getFileExtension,
  inspectDatasetFile,
  isAllowedExtension,
  sanitizeFilename,
} from '../utils/fileUtils.ts';

export interface DatasetRecord {
  id: number;
  user_id: number;
  filename: string;
  original_filename: string;
  file_format: string;
  file_size: number;
  storage_path: string;
  total_rows: number;
  uploaded_at: string;
  complaint_column: string | null;
  category_column: string | null;
  active_analysis_id?: number | null;
}

export function listUserDatasets(userId: number): DatasetRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT d.id, d.user_id, d.filename, d.original_filename, d.file_format, d.file_size,
              d.storage_path, d.total_rows, d.uploaded_at, d.complaint_column, d.category_column,
              (SELECT a.id FROM analyses a
               WHERE a.dataset_id = d.id AND a.user_id = d.user_id AND a.analysis_status IN ('Pending', 'Processing')
               ORDER BY a.id DESC LIMIT 1) as active_analysis_id
       FROM datasets d
       WHERE d.user_id = ?
       ORDER BY datetime(d.uploaded_at) DESC, d.id DESC`
    )
    .all(userId) as unknown as DatasetRecord[];
}

export function getUserDatasetById(
  userId: number,
  datasetId: number
): DatasetRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, user_id, filename, original_filename, file_format, file_size,
              storage_path, total_rows, uploaded_at, complaint_column, category_column
       FROM datasets
       WHERE id = ? AND user_id = ?`
    )
    .get(datasetId, userId) as DatasetRecord | undefined;
  return row || null;
}

export function registerUploadedDataset(
  userId: number,
  tempFilePath: string,
  originalName: string,
  fileSize: number
): { dataset: DatasetRecord; headers: string[] } {
  const safeOriginalName = sanitizeFilename(originalName);
  if (!isAllowedExtension(safeOriginalName)) {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw new Error('Unsupported file type. Only .csv and .xlsx files are allowed.');
  }

  const ext = getFileExtension(safeOriginalName);
  const securePath = buildSecureStoragePath(userId, safeOriginalName);

  try {
    fs.renameSync(tempFilePath, securePath);
  } catch {
    fs.copyFileSync(tempFilePath, securePath);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }

  try {
    const info = inspectDatasetFile(securePath, ext, 10);
    const db = getDb();

    // Auto-detect likely complaint column only as a convenience hint? No—keep null until configured,
    // or let user configure explicitly in Column Configuration modal/view.
    const stmt = db.prepare(
      `INSERT INTO datasets (user_id, filename, original_filename, file_format, file_size, storage_path, total_rows)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      userId,
      safeOriginalName,
      originalName,
      ext.replace('.', '').toUpperCase(),
      fileSize,
      securePath,
      info.totalRows
    );

    const inserted = getUserDatasetById(userId, Number(result.lastInsertRowid));
    if (!inserted) {
      throw new Error('Failed to save dataset metadata.');
    }

    return { dataset: inserted, headers: info.headers };
  } catch (err) {
    if (fs.existsSync(securePath)) {
      fs.unlinkSync(securePath);
    }
    throw err;
  }
}

export function importSampleDatasetForUser(userId: number): {
  dataset: DatasetRecord;
  headers: string[];
} {
  const sampleSrc = path.resolve(process.cwd(), 'server/data/sample_complaints.csv');
  if (!fs.existsSync(sampleSrc)) {
    throw new Error('Sample dataset file is unavailable on the server.');
  }

  const stat = fs.statSync(sampleSrc);
  const securePath = buildSecureStoragePath(userId, 'sample_customer_complaints.csv');
  fs.copyFileSync(sampleSrc, securePath);

  try {
    const info = inspectDatasetFile(securePath, '.csv', 10);
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO datasets (user_id, filename, original_filename, file_format, file_size, storage_path, total_rows, complaint_column, category_column)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        'sample_customer_complaints.csv',
        'sample_customer_complaints.csv',
        'CSV',
        stat.size,
        securePath,
        info.totalRows,
        'complaint_description',
        'existing_category'
      );

    const inserted = getUserDatasetById(userId, Number(result.lastInsertRowid));
    if (!inserted) throw new Error('Failed to create sample dataset record.');
    return { dataset: inserted, headers: info.headers };
  } catch (err) {
    if (fs.existsSync(securePath)) fs.unlinkSync(securePath);
    throw err;
  }
}

export function previewUserDataset(
  userId: number,
  datasetId: number
): {
  dataset: DatasetRecord;
  headers: string[];
  total_rows: number;
  rows: Record<string, string>[];
} {
  const dataset = getUserDatasetById(userId, datasetId);
  if (!dataset) {
    throw new Error('Dataset not found.');
  }

  assertPathInsideDirectory(dataset.storage_path, config.uploadDir);
  if (!fs.existsSync(dataset.storage_path)) {
    throw new Error('Dataset file is missing from storage.');
  }

  const ext = `.${dataset.file_format.toLowerCase()}`;
  const info = inspectDatasetFile(dataset.storage_path, ext, 10);

  return {
    dataset,
    headers: info.headers,
    total_rows: info.totalRows,
    rows: info.previewRows,
  };
}

export function configureDatasetColumns(
  userId: number,
  datasetId: number,
  complaintColumn: string,
  categoryColumn: string | null
): DatasetRecord {
  const dataset = getUserDatasetById(userId, datasetId);
  if (!dataset) {
    throw new Error('Dataset not found.');
  }

  const trimmedComplaint = (complaintColumn || '').trim();
  const trimmedCategory = categoryColumn ? categoryColumn.trim() : null;

  if (!trimmedComplaint) {
    throw new Error('Complaint text column is required.');
  }

  if (trimmedCategory && trimmedCategory === trimmedComplaint) {
    throw new Error('Existing category column must be different from the complaint text column.');
  }

  assertPathInsideDirectory(dataset.storage_path, config.uploadDir);
  const ext = `.${dataset.file_format.toLowerCase()}`;
  const info = inspectDatasetFile(dataset.storage_path, ext, 1);

  if (!info.headers.includes(trimmedComplaint)) {
    throw new Error(`Column "${trimmedComplaint}" does not exist in the uploaded dataset.`);
  }
  if (trimmedCategory && !info.headers.includes(trimmedCategory)) {
    throw new Error(`Column "${trimmedCategory}" does not exist in the uploaded dataset.`);
  }

  const db = getDb();
  db.prepare(
    'UPDATE datasets SET complaint_column = ?, category_column = ? WHERE id = ? AND user_id = ?'
  ).run(trimmedComplaint, trimmedCategory || null, datasetId, userId);

  const updated = getUserDatasetById(userId, datasetId);
  if (!updated) throw new Error('Dataset not found after update.');
  return updated;
}

export function deleteUserDataset(userId: number, datasetId: number): void {
  const dataset = getUserDatasetById(userId, datasetId);
  if (!dataset) {
    throw new Error('Dataset not found.');
  }

  const db = getDb();
  const activeAnalysis = db
    .prepare(
      `SELECT id FROM analyses
       WHERE dataset_id = ? AND user_id = ? AND analysis_status IN ('Pending', 'Processing')`
    )
    .get(datasetId, userId);

  if (activeAnalysis) {
    throw new Error('Cannot delete dataset while an analysis is currently running.');
  }

  assertPathInsideDirectory(dataset.storage_path, config.uploadDir);
  db.prepare('DELETE FROM datasets WHERE id = ? AND user_id = ?').run(datasetId, userId);

  if (fs.existsSync(dataset.storage_path)) {
    fs.unlinkSync(dataset.storage_path);
  }
}
