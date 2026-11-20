import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import ExcelJS from 'exceljs';
import { config } from '../config.ts';
import { getDb, initDatabase } from '../database.ts';
import { createServerApp } from '../../server.ts';
import {
  executeAnalysisJob,
  recoverInterruptedAnalyses,
} from '../services/analysisService.ts';

let server: http.Server;
let baseUrl = '';
let tempDir = '';

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accas-test-'));
  config.databasePath = path.join(tempDir, 'test.db');
  config.uploadDir = path.join(tempDir, 'uploads');
  fs.mkdirSync(config.uploadDir, { recursive: true });
  initDatabase(config.databasePath);

  const app = await createServerApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function apiJson(
  endpoint: string,
  options: { method?: string; token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('End-to-end Auth, Dataset Upload, Preview, Analysis, Isolation, and Excel/PDF Reports', async () => {
  // 1. Register User A
  const regA = await apiJson('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'Analyst A',
      email: 'analystA@example.org',
      password: 'Password123',
      confirm_password: 'Password123',
    },
  });
  assert.equal(regA.status, 201);
  assert.ok(regA.data.access_token);
  const tokenA = regA.data.access_token as string;
  const userAId = regA.data.user.id as number;

  // Duplicate email rejected
  const dupReg = await apiJson('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'Analyst Dup',
      email: 'analystA@example.org',
      password: 'Password123',
      confirm_password: 'Password123',
    },
  });
  assert.equal(dupReg.status, 409);

  // Login succeeds & /api/auth/me works
  const loginA = await apiJson('/api/auth/login', {
    method: 'POST',
    body: { email: 'analystA@example.org', password: 'Password123' },
  });
  assert.equal(loginA.status, 200);
  const meA = await apiJson('/api/auth/me', { token: tokenA });
  assert.equal(meA.status, 200);
  assert.equal(meA.data.email, 'analysta@example.org');

  // Unauthenticated access rejected
  const unauth = await apiJson('/api/datasets');
  assert.equal(unauth.status, 401);

  // 2. Register User B to test strict multi-user isolation
  const regB = await apiJson('/api/auth/register', {
    method: 'POST',
    body: {
      username: 'Analyst B',
      email: 'analystB@example.org',
      password: 'Password123',
      confirm_password: 'Password123',
    },
  });
  assert.equal(regB.status, 201);
  const tokenB = regB.data.access_token as string;

  // 3. Upload a multilingual utility CSV dataset (with formula injection payload to test sanitization in Excel)
  const csvContent = [
    'ticket_id,complaint_text,existing_cat',
    'T1,"Recharge kiya UPI se payment deducted ho gaya par balance update nahi hua.",Recharge/payment made but balance not updated',
    'T2,"बिजली नहीं आ रही है घर में सप्लाई बंद है, कृपया जांच करें।",Power supply interruption / meter powered but home disconnected',
    'T3,"Solar rooftop net-metering export credit missing from monthly dashboard.",',
    'T4,"Solar rooftop net-metering generation telemetry not syncing.",',
    'T5,"=HYPERLINK(""http://evil.example"",""Click"") Meter burnt and display blank after voltage surge.",Meter damaged / faulty / display / blank / not working',
    'T6,"",',
  ].join('\n');

  const form = new FormData();
  form.append(
    'file',
    new Blob([csvContent], { type: 'text/csv' }),
    'test_complaints.csv'
  );
  const uploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: form,
  });
  const uploadData = await uploadRes.json();
  assert.equal(uploadRes.status, 201);
  const datasetId = uploadData.dataset.id as number;
  assert.equal(uploadData.dataset.total_rows, 6);

  // Reject unsupported extension (.txt)
  const badForm = new FormData();
  badForm.append('file', new Blob(['hello'], { type: 'text/plain' }), 'bad.txt');
  const badUpload = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: badForm,
  });
  assert.equal(badUpload.status, 400);

  // 4. Preview Dataset & Verify User B Isolation
  const previewA = await apiJson(`/api/datasets/${datasetId}/preview`, {
    token: tokenA,
  });
  assert.equal(previewA.status, 200);
  assert.equal(previewA.data.rows.length, 6);
  assert.deepEqual(previewA.data.headers, ['ticket_id', 'complaint_text', 'existing_cat']);

  const previewB = await apiJson(`/api/datasets/${datasetId}/preview`, {
    token: tokenB,
  });
  assert.equal(previewB.status, 404);

  // 5. Configure columns
  const badCol = await apiJson(`/api/datasets/${datasetId}/columns`, {
    method: 'PUT',
    token: tokenA,
    body: { complaint_column: 'nonexistent_col' },
  });
  assert.equal(badCol.status, 400);

  const goodCol = await apiJson(`/api/datasets/${datasetId}/columns`, {
    method: 'PUT',
    token: tokenA,
    body: { complaint_column: 'complaint_text', category_column: 'existing_cat' },
  });
  assert.equal(goodCol.status, 200);

  // 6. Run Analysis and wait for completion
  const runRes = await apiJson(`/api/analyses/${datasetId}/run`, {
    method: 'POST',
    token: tokenA,
    body: { confidence_threshold: 0.4 },
  });
  assert.equal(runRes.status, 202);
  const analysisId = runRes.data.analysis.id as number;

  // Poll until Completed
  let status = runRes.data.analysis.analysis_status;
  for (let i = 0; i < 40 && status !== 'Completed' && status !== 'Failed'; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const prog = await apiJson(`/api/analyses/${analysisId}/progress`, {
      token: tokenA,
    });
    status = prog.data.analysis_status;
  }
  assert.equal(status, 'Completed');

  // Verify User B cannot read User A's analysis or statistics
  const statsB = await apiJson(`/api/analyses/${analysisId}/statistics`, {
    token: tokenB,
  });
  assert.equal(statsB.status, 404);

  // 7. Verify Statistics, Top-3 KPIs, Rank, & Results Pagination
  const statsA = await apiJson(`/api/analyses/${analysisId}/statistics`, {
    token: tokenA,
  });
  assert.equal(statsA.status, 200);
  assert.equal(statsA.data.total_complaints, 6);
  assert.equal(statsA.data.empty_count, 1);
  assert.equal(statsA.data.eligible_complaints, 5);
  assert.ok(statsA.data.top3_categories_count >= 1);
  assert.ok(statsA.data.top3_categories_share > 0);
  assert.equal(statsA.data.category_summary[0].rank, 1);
  assert.ok(statsA.data.candidate_groups_count >= 1);

  const resultsA = await apiJson(
    `/api/analyses/${analysisId}/results?page=1&page_size=10`,
    { token: tokenA }
  );
  assert.equal(resultsA.status, 200);
  assert.equal(resultsA.data.items.length, 6);
  // Ensure Hindi Devanagari row was classified and not treated as Empty Text
  assert.equal(resultsA.data.items[1].classification_status, 'Classified');
  assert.equal(
    resultsA.data.items[1].predicted_category,
    'Power supply interruption / meter powered but home disconnected'
  );

  // 8. Verify Executive Excel Report (3 worksheets, Sheet 1 Categorization Report + PNG chart at F4, Sheet 2 formula sanitization)
  const excelRes = await fetch(`${baseUrl}/api/reports/${analysisId}/excel`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(excelRes.status, 200);
  const excelArrayBuf = await excelRes.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(excelArrayBuf);
  assert.deepEqual(
    wb.worksheets.map((w) => w.name),
    ['Categorization Report', 'Complaint Results', 'Report Information']
  );

  const wsSummary = wb.getWorksheet('Categorization Report')!;
  assert.equal(
    wsSummary.getCell('A1').value,
    'Customer Complaint Categorization Report'
  );
  assert.equal(
    wsSummary.getCell('A2').value,
    'Based on 5 non-empty complaint entries'
  );
  assert.equal(wsSummary.getRow(4).getCell(1).value, 'Total complaints');
  assert.equal(wsSummary.getRow(4).getCell(2).value, 5);
  assert.equal(wsSummary.getRow(5).getCell(1).value, 'Top 3 categories (count)');
  assert.equal(wsSummary.getRow(6).getCell(1).value, 'Top 3 categories (share)');
  assert.equal(wsSummary.getRow(6).getCell(2).numFmt, '0.0%');
  assert.deepEqual(
    [
      wsSummary.getRow(8).getCell(1).value,
      wsSummary.getRow(8).getCell(2).value,
      wsSummary.getRow(8).getCell(3).value,
      wsSummary.getRow(8).getCell(4).value,
    ],
    ['Issue Type', 'Complaint Count', 'Percentage', 'Rank']
  );

  const totalRowIdx = 8 + statsA.data.category_summary.length + 1;
  assert.equal(wsSummary.getRow(totalRowIdx).getCell(1).value, 'TOTAL');
  assert.equal(wsSummary.getRow(totalRowIdx).getCell(2).value, 5);
  assert.equal(wsSummary.getRow(totalRowIdx).getCell(3).value, 1);
  assert.equal(wsSummary.getRow(totalRowIdx).getCell(3).numFmt, '0.0%');

  const images = wsSummary.getImages();
  assert.equal(images.length, 1);
  assert.equal(images[0].range.tl.col, 5); // Column F
  assert.equal(images[0].range.tl.row, 3); // Row 4

  assert.equal(wsSummary.getColumn(1).width, 56);
  assert.equal(wsSummary.getColumn(2).width, 20);
  assert.equal(wsSummary.getColumn(3).width, 18);
  assert.equal(wsSummary.getColumn(4).width, 11);
  assert.equal(wsSummary.getRow(4).getCell(1).border?.top?.color?.argb, 'FFCBD5E1');
  assert.equal(wsSummary.getRow(6).getCell(2).border?.bottom?.color?.argb, 'FFCBD5E1');

  const wsResults = wb.getWorksheet('Complaint Results')!;
  const row5Desc = String(wsResults.getRow(6).getCell(3).value);
  assert.ok(
    row5Desc.startsWith("'=HYPERLINK"),
    'Formula injection should be escaped with leading apostrophe'
  );

  // 9. Verify PDF Report
  const pdfRes = await fetch(`${baseUrl}/api/reports/${analysisId}/pdf`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  assert.equal(pdfRes.status, 200);
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  assert.ok(pdfBuf.subarray(0, 5).toString('utf-8') === '%PDF-');
  assert.ok(pdfBuf.length > 1500);

  // Ensure User B cannot download User A's reports
  const excelB = await fetch(`${baseUrl}/api/reports/${analysisId}/excel`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(excelB.status, 404);

  // Verify dashboard summary uses real DB records
  const dashA = await apiJson('/api/dashboard/summary', { token: tokenA });
  assert.equal(dashA.status, 200);
  assert.equal(dashA.data.total_datasets, 1);
  assert.equal(dashA.data.completed_analyses, 1);
  assert.equal(dashA.data.total_complaints_uploaded, 6);
  assert.ok(userAId > 0);

  // 10. Verify XLSX upload, preview, and column configuration using buffer-based XLSX parsing
  const xlsxWb = new ExcelJS.Workbook();
  const sheet = xlsxWb.addWorksheet('Complaints');
  sheet.addRow(['ticket_id', 'complaint_description']);
  sheet.addRow(['X1', 'High bill received this month please do bill correction.']);
  sheet.addRow(['X2', 'Smart meter display is blank after power outage.']);
  const xlsxArrayBuf = await xlsxWb.xlsx.writeBuffer();

  const xlsxForm = new FormData();
  xlsxForm.append(
    'file',
    new Blob([xlsxArrayBuf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'sample_upload.xlsx'
  );
  const xlsxUpload = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: xlsxForm,
  });
  const xlsxData = await xlsxUpload.json();
  assert.equal(xlsxUpload.status, 201);
  assert.equal(xlsxData.dataset.file_format, 'XLSX');
  assert.equal(xlsxData.dataset.total_rows, 2);

  const xlsxPreview = await apiJson(`/api/datasets/${xlsxData.dataset.id}/preview`, {
    token: tokenA,
  });
  assert.equal(xlsxPreview.status, 200);
  assert.equal(xlsxPreview.data.rows.length, 2);

  // 11. Verify sample dataset import endpoint
  const sampleImport = await apiJson('/api/datasets/import-sample', {
    method: 'POST',
    token: tokenA,
  });
  assert.equal(sampleImport.status, 201);
  assert.equal(sampleImport.data.dataset.total_rows, 30);

  // 12. Verify cancel/reset for stuck analyses and startup recovery ('Interrupted by server restart')
  const sampleDatasetId = sampleImport.data.dataset.id as number;
  const db = getDb();
  const stuckInsert = db
    .prepare(
      `INSERT INTO analyses (user_id, dataset_id, analysis_status, total_complaints, processed_complaints, progress_percent)
       VALUES (?, ?, 'Processing', 30, 5, 16.7)`
    )
    .run(userAId, sampleDatasetId);
  const stuckId = Number(stuckInsert.lastInsertRowid);

  // Dataset deletion is blocked while analysis is active
  const blockedDelete = await apiJson(`/api/datasets/${sampleDatasetId}`, {
    method: 'DELETE',
    token: tokenA,
  });
  assert.equal(blockedDelete.status, 400);
  assert.ok(String(blockedDelete.data.detail).includes('currently running'));

  // Cancel / reset unblocks it immediately
  const cancelRes = await apiJson(`/api/analyses/${stuckId}/cancel`, {
    method: 'POST',
    token: tokenA,
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.data.analysis.analysis_status, 'Failed');

  // Insert another stuck Pending analysis and simulate server restart recovery
  const stuckPending = db
    .prepare(
      `INSERT INTO analyses (user_id, dataset_id, analysis_status, total_complaints, processed_complaints, progress_percent)
       VALUES (?, ?, 'Pending', 30, 0, 0)`
    )
    .run(userAId, sampleDatasetId);
  const stuckPendingId = Number(stuckPending.lastInsertRowid);

  const recoveredCount = recoverInterruptedAnalyses();
  assert.ok(recoveredCount >= 1);
  const recoveredCheck = await apiJson(`/api/analyses/${stuckPendingId}`, {
    token: tokenA,
  });
  assert.equal(recoveredCheck.status, 200);
  assert.equal(recoveredCheck.data.analysis_status, 'Failed');
  assert.equal(recoveredCheck.data.error_message, 'Interrupted by server restart');

  // Dataset can now be deleted cleanly
  const unlockedDelete = await apiJson(`/api/datasets/${sampleDatasetId}`, {
    method: 'DELETE',
    token: tokenA,
  });
  assert.equal(unlockedDelete.status, 200);

  void executeAnalysisJob;
});
