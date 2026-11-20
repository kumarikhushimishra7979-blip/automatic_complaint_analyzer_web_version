import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { parse as parseCsvStream } from 'csv-parse';
import { config } from '../config.ts';

const xlsxLib: typeof XLSX =
  (XLSX as unknown as { default?: typeof XLSX }).default ?? XLSX;

function readWorkbookFromBuffer(filePath: string): XLSX.WorkBook {
  const buffer = fs.readFileSync(filePath);
  const readFn =
    xlsxLib.read ??
    (XLSX as unknown as { default?: typeof XLSX }).default?.read ??
    XLSX.read;
  if (typeof readFn !== 'function') {
    throw new Error('Unable to initialize Excel workbook reader.');
  }
  return readFn(buffer, { type: 'buffer', cellDates: true });
}

function getXlsxUtils(): typeof XLSX.utils {
  return (
    xlsxLib.utils ??
    (XLSX as unknown as { default?: typeof XLSX }).default?.utils ??
    XLSX.utils
  );
}

export interface ParsedDatasetInfo {
  headers: string[];
  totalRows: number;
  previewRows: Record<string, string>[];
}

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx']);

export function sanitizeFilename(originalName: string): string {
  const base = path.basename(originalName || 'dataset');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
  return cleaned || 'dataset.csv';
}

export function getFileExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(getFileExtension(filename));
}

export function buildSecureStoragePath(userId: number, sanitizedName: string): string {
  const userDir = path.resolve(config.uploadDir, `user_${userId}`);
  fs.mkdirSync(userDir, { recursive: true });
  const uniquePrefix = crypto.randomUUID();
  const targetPath = path.resolve(userDir, `${uniquePrefix}_${sanitizedName}`);
  assertPathInsideDirectory(targetPath, config.uploadDir);
  return targetPath;
}

export function assertPathInsideDirectory(targetPath: string, baseDir: string): void {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(resolvedBase + path.sep)
  ) {
    throw new Error('Invalid file path detected.');
  }
}

export function validateFileMagic(filePath: string, ext: string): void {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error('The uploaded file is empty.');
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(Math.min(512, stat.size));
    fs.readSync(fd, buf, 0, buf.length, 0);

    if (ext === '.xlsx') {
      // XLSX files are ZIP archives starting with PK\x03\x04
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw new Error('The uploaded .xlsx file appears to be corrupted or invalid.');
      }
    } else if (ext === '.csv') {
      // Reject binary files masquerading as CSV (null bytes)
      if (buf.includes(0x00)) {
        throw new Error('The uploaded .csv file contains invalid binary data.');
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val);
}

export function inspectDatasetFile(
  filePath: string,
  ext: string,
  previewLimit = 10
): ParsedDatasetInfo {
  assertPathInsideDirectory(filePath, config.uploadDir);
  validateFileMagic(filePath, ext);

  if (ext === '.csv') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const records = parseCsvSync(raw, {
      columns: true,
      skip_empty_lines: false,
      relax_column_count: true,
      bom: true,
    }) as Record<string, unknown>[];

    if (!records || records.length === 0) {
      // Try reading header-only CSV
      const headerOnly = parseCsvSync(raw, {
        to_line: 1,
        bom: true,
      }) as string[][];
      if (!headerOnly || headerOnly.length === 0 || headerOnly[0].length === 0) {
        throw new Error('The CSV file does not contain valid column headers.');
      }
      throw new Error('The CSV file contains headers but no data rows.');
    }

    const headers = Object.keys(records[0]).filter((h) => h.trim().length > 0);
    if (headers.length === 0) {
      throw new Error('No valid column headers were found in the CSV file.');
    }

    const previewRows = records.slice(0, previewLimit).map((row) => {
      const normalized: Record<string, string> = {};
      for (const h of headers) {
        normalized[h] = normalizeCellValue(row[h]);
      }
      return normalized;
    });

    return {
      headers,
      totalRows: records.length,
      previewRows,
    };
  }

  if (ext === '.xlsx') {
    const workbook = readWorkbookFromBuffer(filePath);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('The Excel workbook contains no worksheets.');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const matrix = getXlsxUtils().sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    if (!matrix || matrix.length < 2) {
      throw new Error('The Excel worksheet must contain a header row and at least one data row.');
    }

    const rawHeaders = (matrix[0] || []).map((h, idx) => {
      const text = normalizeCellValue(h).trim();
      return text || `Column_${idx + 1}`;
    });

    const dataRows = matrix.slice(1);
    const previewRows = dataRows.slice(0, previewLimit).map((arr) => {
      const normalized: Record<string, string> = {};
      rawHeaders.forEach((h, i) => {
        normalized[h] = normalizeCellValue(arr[i]);
      });
      return normalized;
    });

    return {
      headers: rawHeaders,
      totalRows: dataRows.length,
      previewRows,
    };
  }

  throw new Error('Unsupported file format. Please upload a .csv or .xlsx file.');
}

export async function readDatasetRowsInBatches(
  filePath: string,
  ext: string,
  batchSize: number,
  onBatch: (rows: Record<string, string>[], startRowIndex: number) => Promise<void>
): Promise<number> {
  assertPathInsideDirectory(filePath, config.uploadDir);

  if (ext === '.csv') {
    return new Promise((resolve, reject) => {
      const batch: Record<string, string>[] = [];
      let rowIndex = 0;
      let batchStart = 0;

      const stream = fs.createReadStream(filePath, { encoding: 'utf-8' }).pipe(
        parseCsvStream({
          columns: true,
          skip_empty_lines: false,
          relax_column_count: true,
          bom: true,
        })
      );

      stream.on('data', async (record: Record<string, unknown>) => {
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(record)) {
          normalized[k] = normalizeCellValue(v);
        }
        if (batch.length === 0) {
          batchStart = rowIndex;
        }
        batch.push(normalized);
        rowIndex++;

        if (batch.length >= batchSize) {
          stream.pause();
          const toProcess = batch.splice(0, batch.length);
          const start = batchStart;
          try {
            await onBatch(toProcess, start);
            await new Promise<void>((res) => setImmediate(res));
            stream.resume();
          } catch (err) {
            stream.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });

      stream.on('end', async () => {
        try {
          if (batch.length > 0) {
            await onBatch(batch.splice(0, batch.length), batchStart);
          }
          resolve(rowIndex);
        } catch (err) {
          reject(err);
        }
      });

      stream.on('error', (err) => reject(err));
    });
  }

  if (ext === '.xlsx') {
    await new Promise<void>((res) => setImmediate(res));
    const workbook = readWorkbookFromBuffer(filePath);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('Workbook contains no worksheets.');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const matrix = getXlsxUtils().sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    if (matrix.length < 2) return 0;

    const headers = (matrix[0] || []).map((h, idx) => {
      const text = normalizeCellValue(h).trim();
      return text || `Column_${idx + 1}`;
    });

    const dataRows = matrix.slice(1);
    for (let i = 0; i < dataRows.length; i += batchSize) {
      const slice = dataRows.slice(i, i + batchSize).map((arr) => {
        const normalized: Record<string, string> = {};
        headers.forEach((h, idx) => {
          normalized[h] = normalizeCellValue(arr[idx]);
        });
        return normalized;
      });
      await onBatch(slice, i);
      await new Promise<void>((res) => setImmediate(res));
    }
    return dataRows.length;
  }

  throw new Error('Unsupported file format.');
}

export function readAllOriginalRows(filePath: string, ext: string): { headers: string[]; rows: Record<string, string>[] } {
  assertPathInsideDirectory(filePath, config.uploadDir);
  if (ext === '.csv') {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const records = parseCsvSync(raw, {
      columns: true,
      skip_empty_lines: false,
      relax_column_count: true,
      bom: true,
    }) as Record<string, unknown>[];
    const headers = records.length > 0 ? Object.keys(records[0]).filter((h) => h.trim().length > 0) : [];
    const rows = records.map((r) => {
      const out: Record<string, string> = {};
      for (const h of headers) out[h] = normalizeCellValue(r[h]);
      return out;
    });
    return { headers, rows };
  }

  const workbook = readWorkbookFromBuffer(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = getXlsxUtils().sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  if (matrix.length < 2) return { headers: [], rows: [] };
  const headers = (matrix[0] || []).map((h, idx) => normalizeCellValue(h).trim() || `Column_${idx + 1}`);
  const rows = matrix.slice(1).map((arr) => {
    const out: Record<string, string> = {};
    headers.forEach((h, idx) => {
      out[h] = normalizeCellValue(arr[idx]);
    });
    return out;
  });
  return { headers, rows };
}

/**
 * Neutralizes spreadsheet formula injection (CSV/Excel cells starting with =, +, -, @, tab, CR).
 */
export function sanitizeExcelCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.length === 0) return '';
  const firstChar = str[0];
  if (
    firstChar === '=' ||
    firstChar === '+' ||
    firstChar === '-' ||
    firstChar === '@' ||
    firstChar === '\t' ||
    firstChar === '\r'
  ) {
    return `'${str}`;
  }
  return str;
}
