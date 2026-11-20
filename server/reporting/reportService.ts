import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import { getDb } from '../database.ts';
import { getUserAnalysisById } from '../services/analysisService.ts';
import { getUserDatasetById } from '../services/datasetService.ts';
import { getAnalysisStatistics } from '../services/statisticsService.ts';
import { readAllOriginalRows, sanitizeExcelCell } from '../utils/fileUtils.ts';
import { CHART_PALETTE, renderCategoryBarChartPng } from './chartRenderer.ts';

interface ResultRow {
  row_index: number;
  complaint_text: string;
  existing_category: string | null;
  predicted_category: string | null;
  confidence_score: number;
  classification_status: string;
  needs_review: number;
  candidate_group: string | null;
}

const NAVY_HEX = 'FF17324D';
const ICE_BLUE_HEX = 'FFDCE6F1';
const ZEBRA_ALT_HEX = 'FFF2F6FA';

export async function generateExcelReport(
  userId: number,
  analysisId: number
): Promise<{ buffer: Buffer; filename: string }> {
  const analysis = getUserAnalysisById(userId, analysisId);
  if (!analysis) {
    throw new Error('Analysis not found.');
  }
  if (analysis.analysis_status !== 'Completed') {
    throw new Error('Reports can only be generated for completed analyses.');
  }

  const dataset = getUserDatasetById(userId, analysis.dataset_id);
  const stats = getAnalysisStatistics(userId, analysisId);
  if (!dataset || !stats) {
    throw new Error('Associated dataset or statistics not found.');
  }

  const db = getDb();
  const results = db
    .prepare(
      `SELECT row_index, complaint_text, existing_category, predicted_category,
              confidence_score, classification_status, needs_review, candidate_group
       FROM complaint_results
       WHERE analysis_id = ?
       ORDER BY row_index ASC`
    )
    .all(analysisId) as unknown as ResultRow[];

  let extraColumns: string[] = [];
  let originalRows: Record<string, string>[] = [];
  if (fs.existsSync(dataset.storage_path)) {
    try {
      const parsed = readAllOriginalRows(
        dataset.storage_path,
        `.${dataset.file_format.toLowerCase()}`
      );
      extraColumns = parsed.headers.filter(
        (h) => h !== dataset.complaint_column && h !== dataset.category_column
      );
      originalRows = parsed.rows;
    } catch {
      extraColumns = [];
      originalRows = [];
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Automatic Customer Complaint Analysis System';
  workbook.created = new Date();

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };

  // =========================================================================
  // Sheet 1: Categorization Report (Executive Layout + Embedded PNG Chart)
  // =========================================================================
  const wsSummary = workbook.addWorksheet('Categorization Report', {
    views: [{ state: 'frozen', ySplit: 8 }],
  });

  // Row 1 (Merged A1:D1): Dark navy fill (#17324D), bold white centered 16pt title
  wsSummary.mergeCells('A1:D1');
  const titleCell = wsSummary.getCell('A1');
  titleCell.value = 'Customer Complaint Categorization Report';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: NAVY_HEX },
  };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  wsSummary.getRow(1).height = 34;

  // Row 2 (Merged A2:D2): Italic dark-slate subtitle with thousands separators
  wsSummary.mergeCells('A2:D2');
  const subtitleCell = wsSummary.getCell('A2');
  subtitleCell.value = `Based on ${stats.eligible_complaints.toLocaleString(
    'en-US'
  )} non-empty complaint entries`;
  subtitleCell.font = { italic: true, size: 10.5, color: { argb: 'FF334155' } };
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  wsSummary.getRow(2).height = 22;

  wsSummary.addRow([]);
  wsSummary.getRow(3).height = 10;

  // Rows 4-6 (A4:B6): Soft ice-blue KPI block (#DCE6F1)
  const kpiRows: { label: string; value: number; numFmt: string }[] = [
    { label: 'Total complaints', value: stats.eligible_complaints, numFmt: '#,##0' },
    { label: 'Top 3 categories (count)', value: stats.top3_categories_count, numFmt: '#,##0' },
    {
      label: 'Top 3 categories (share)',
      value: Number((stats.top3_categories_share / 100).toFixed(4)),
      numFmt: '0.0%',
    },
  ];

  kpiRows.forEach((kpi, i) => {
    const rowIdx = 4 + i;
    const r = wsSummary.getRow(rowIdx);
    r.height = 22;
    const cLabel = r.getCell(1);
    const cVal = r.getCell(2);
    cLabel.value = kpi.label;
    cVal.value = kpi.value;
    cVal.numFmt = kpi.numFmt;

    cLabel.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
    cLabel.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: ICE_BLUE_HEX },
    };
    cLabel.alignment = { vertical: 'middle', horizontal: 'left' };
    cLabel.border = thinBorder;

    cVal.font = { bold: true, size: 10.5, color: { argb: 'FF0F172A' } };
    cVal.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: ZEBRA_ALT_HEX },
    };
    cVal.alignment = { vertical: 'middle', horizontal: 'right' };
    cVal.border = thinBorder;
  });

  wsSummary.getRow(7).height = 10;

  // Row 8 (A8:D8): Dark navy (#17324D) bold white headers with auto-filters
  const summaryHeader = wsSummary.getRow(8);
  summaryHeader.values = ['Issue Type', 'Complaint Count', 'Percentage', 'Rank'];
  summaryHeader.height = 24;
  for (let col = 1; col <= 4; col++) {
    const cell = summaryHeader.getCell(col);
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: NAVY_HEX },
    };
    cell.border = thinBorder;
    cell.alignment = {
      vertical: 'middle',
      horizontal: col === 1 ? 'center' : col === 3 ? 'right' : 'center',
    };
  }

  // Category Data Rows (Rows 9..)
  const firstDataRow = 9;
  stats.category_summary.forEach((c, idx) => {
    const rowNum = firstDataRow + idx;
    const row = wsSummary.getRow(rowNum);
    row.values = [
      sanitizeExcelCell(c.category),
      c.count,
      Number((c.percentage / 100).toFixed(4)),
      c.rank,
    ];
    row.height = 20;

    const zebraFill = idx % 2 === 0 ? 'FFFFFFFF' : ZEBRA_ALT_HEX;
    for (let col = 1; col <= 4; col++) {
      const cell = row.getCell(col);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: zebraFill },
      };
      cell.border = thinBorder;
      cell.font = { size: 10, color: { argb: 'FF0F172A' } };
      if (col === 1) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      } else if (col === 2) {
        cell.numFmt = '#,##0';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (col === 3) {
        cell.numFmt = '0.0%';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.numFmt = '0';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    }
  });

  const lastDataRow = firstDataRow + stats.category_summary.length - 1;
  if (stats.category_summary.length > 0) {
    wsSummary.addConditionalFormatting({
      ref: `C${firstDataRow}:C${lastDataRow}`,
      rules: [
        {
          type: 'dataBar',
          priority: 1,
          gradient: true,
          showValue: true,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: { argb: 'FF4F81BD' },
        } as unknown as ExcelJS.ConditionalFormattingRule,
      ],
    });
  }

  // TOTAL Row immediately after category rows (Row 23 for 14 categories)
  const totalRowNum = firstDataRow + stats.category_summary.length;
  const totalRow = wsSummary.getRow(totalRowNum);
  totalRow.values = [
    'TOTAL',
    stats.eligible_complaints,
    stats.eligible_complaints > 0 ? 1 : 0,
    '',
  ];
  totalRow.height = 23;
  for (let col = 1; col <= 4; col++) {
    const cell = totalRow.getCell(col);
    cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: ICE_BLUE_HEX },
    };
    cell.border = {
      top: { style: 'medium', color: { argb: NAVY_HEX } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: NAVY_HEX } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
    if (col === 1) {
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    } else if (col === 2) {
      cell.numFmt = '#,##0';
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    } else if (col === 3) {
      cell.numFmt = '0.0%';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  }

  wsSummary.autoFilter = {
    from: { row: 8, column: 1 },
    to: { row: 8, column: 4 },
  };
  wsSummary.getColumn(1).width = 56;
  wsSummary.getColumn(2).width = 20;
  wsSummary.getColumn(3).width = 18;
  wsSummary.getColumn(4).width = 11;
  wsSummary.getColumn(5).width = 4;

  // Embed high-resolution server-rendered PNG horizontal bar chart anchored at F4
  const chartPng = renderCategoryBarChartPng(
    stats.category_summary,
    'Complaints by Issue Type'
  );
  const chartImageId = workbook.addImage({
    buffer: chartPng as unknown as ExcelJS.Buffer,
    extension: 'png',
  });
  const chartPixelHeight =
    stats.category_summary.length <= 14
      ? 470
      : Math.max(470, 110 + stats.category_summary.length * 26);
  wsSummary.addImage(chartImageId, {
    tl: { col: 5, row: 3 }, // Cell F4 (0-indexed: col=5 is F, row=3 is Row 4)
    ext: { width: 760, height: chartPixelHeight },
  });

  // =========================================================================
  // Sheet 2: Complaint Results (Full row-by-row analysed dataset)
  // =========================================================================
  const wsResults = workbook.addWorksheet('Complaint Results', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const headers = [
    'S/N',
    ...extraColumns,
    'Complaint Description',
    ...(dataset.category_column ? ['Existing Category'] : []),
    'Predicted Category',
    'Confidence %',
    'Status',
    'Review Required',
    'Candidate Group',
  ];

  const headerRow = wsResults.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: NAVY_HEX },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 24;

  results.forEach((r) => {
    const orig = originalRows[r.row_index - 1] || {};
    const rowValues: (string | number)[] = [
      r.row_index,
      ...extraColumns.map((col) => sanitizeExcelCell(orig[col] ?? '')),
      sanitizeExcelCell(r.complaint_text),
      ...(dataset.category_column
        ? [sanitizeExcelCell(r.existing_category ?? '')]
        : []),
      sanitizeExcelCell(r.predicted_category ?? ''),
      Number((r.confidence_score * 100).toFixed(1)),
      r.classification_status,
      r.needs_review ? 'Yes' : 'No',
      sanitizeExcelCell(r.candidate_group ?? ''),
    ];
    const row = wsResults.addRow(rowValues);
    row.alignment = { vertical: 'top', wrapText: true };
  });

  wsResults.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  wsResults.columns.forEach((col, idx) => {
    const label = headers[idx] || '';
    if (label === 'Complaint Description') {
      col.width = 48;
    } else if (label === 'Candidate Group' || label === 'Predicted Category') {
      col.width = 36;
    } else if (label === 'S/N') {
      col.width = 10;
    } else {
      col.width = Math.max(16, Math.min(30, label.length + 6));
    }
  });

  // =========================================================================
  // Sheet 3: Report Information
  // =========================================================================
  const wsInfo = workbook.addWorksheet('Report Information');
  const infoHeader = wsInfo.addRow(['Report Field', 'Value']);
  infoHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  infoHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: NAVY_HEX },
  };
  infoHeader.height = 24;

  const generatedAt = new Date().toISOString();
  const infoRows: [string, string | number][] = [
    ['Application Name', 'Automatic Customer Complaint Analysis System'],
    ['Analysis ID', analysis.id],
    ['Dataset ID', dataset.id],
    ['Dataset Filename', sanitizeExcelCell(dataset.filename)],
    ['Report Generation Date (UTC)', generatedAt],
    ['Confidence Threshold', `${(analysis.confidence_threshold * 100).toFixed(0)}%`],
    ['Total Complaints Processed', stats.total_complaints],
    ['Total Non-Empty Complaints', stats.eligible_complaints],
    ['Successfully Classified Complaints', stats.classified_count],
    ['Review-Required Complaints', stats.review_count],
    ['Empty Complaints', stats.empty_count],
    ['Top 3 Categories (Count)', stats.top3_categories_count],
    ['Top 3 Categories (Share)', `${stats.top3_categories_share.toFixed(1)}%`],
    ['Discovered Candidate Groups', stats.candidate_groups_count],
  ];

  infoRows.forEach(([k, v]) => {
    const r = wsInfo.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  });
  wsInfo.getColumn(1).width = 34;
  wsInfo.getColumn(2).width = 50;

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    filename: `complaint_analysis_${analysisId}.xlsx`,
  };
}

export async function generatePdfReport(
  userId: number,
  analysisId: number
): Promise<{ buffer: Buffer; filename: string }> {
  const analysis = getUserAnalysisById(userId, analysisId);
  if (!analysis) {
    throw new Error('Analysis not found.');
  }
  if (analysis.analysis_status !== 'Completed') {
    throw new Error('Reports can only be generated for completed analyses.');
  }

  const dataset = getUserDatasetById(userId, analysis.dataset_id);
  const stats = getAnalysisStatistics(userId, analysisId);
  if (!dataset || !stats) {
    throw new Error('Associated dataset or statistics not found.');
  }

  const db = getDb();
  const results = db
    .prepare(
      `SELECT row_index, complaint_text, predicted_category,
              confidence_score, classification_status, needs_review, candidate_group
       FROM complaint_results
       WHERE analysis_id = ?
       ORDER BY row_index ASC`
    )
    .all(analysisId) as unknown as ResultRow[];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 28,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', (err) => reject(err));
    doc.on('end', () => {
      resolve({
        buffer: Buffer.concat(chunks),
        filename: `complaint_analysis_${analysisId}.pdf`,
      });
    });

    const leftX = doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    // =========================================================================
    // Page 1: Executive Customer Complaint Categorization Report
    // =========================================================================
    // 1. Dark Navy Title Banner (#17324D)
    doc.rect(leftX, 26, pageWidth, 32).fill('#17324D');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15);
    doc.text('Customer Complaint Categorization Report', leftX, 34, {
      width: pageWidth,
      align: 'center',
    });

    // 2. Subtitle + Meta Strip
    doc.fillColor('#334155').font('Helvetica-Oblique').fontSize(9.5);
    doc.text(
      `Based on ${stats.eligible_complaints.toLocaleString('en-US')} non-empty complaint entries`,
      leftX,
      63,
      { width: pageWidth, align: 'center' }
    );
    doc.fillColor('#64748B').font('Helvetica').fontSize(8);
    doc.text(
      `Analysis #${analysis.id}   |   Dataset: ${dataset.filename}   |   Generated: ${generatedAt}   |   Review Threshold: ${(analysis.confidence_threshold * 100).toFixed(0)}%`,
      leftX,
      77,
      { width: pageWidth, align: 'center' }
    );

    // 3. Left Column: Light-Blue KPI Summary Box + 4-Column Category Summary Table
    const leftColWidth = 408;
    const kpiY = 96;
    const kpiRows: [string, string][] = [
      ['Total complaints', String(stats.eligible_complaints)],
      ['Top 3 categories (count)', String(stats.top3_categories_count)],
      ['Top 3 categories (share)', `${stats.top3_categories_share.toFixed(1)}%`],
    ];

    kpiRows.forEach(([label, value], i) => {
      const ry = kpiY + i * 17;
      doc.rect(leftX, ry, 250, 17).fillAndStroke('#DCE6F1', '#CBD5E1');
      doc.rect(leftX + 250, ry, leftColWidth - 250, 17).fillAndStroke('#F2F6FA', '#CBD5E1');
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5);
      doc.text(label, leftX + 8, ry + 4.5, { width: 235 });
      doc.text(value, leftX + 255, ry + 4.5, {
        width: leftColWidth - 263,
        align: 'right',
      });
    });

    // 4-Column Categorization Table
    const tableY = kpiY + 3 * 17 + 12;
    const wIssue = 212;
    const wCount = 68;
    const wPct = 92;
    const wRank = leftColWidth - wIssue - wCount - wPct; // 36

    doc.rect(leftX, tableY, leftColWidth, 20).fill('#17324D');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    doc.text('Issue Type', leftX + 6, tableY + 6, { width: wIssue - 10, align: 'center' });
    doc.text('Complaint Count', leftX + wIssue + 2, tableY + 6, { width: wCount - 4, align: 'center' });
    doc.text('Percentage', leftX + wIssue + wCount + 2, tableY + 6, { width: wPct - 8, align: 'right' });
    doc.text('Rank', leftX + wIssue + wCount + wPct + 2, tableY + 6, { width: wRank - 4, align: 'center' });

    const maxPct = Math.max(1, ...stats.category_summary.map((c) => c.percentage));
    let ty = tableY + 20;
    const rowH = stats.category_summary.length > 12 ? 18 : 20;

    stats.category_summary.forEach((cat, idx) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F2F6FA';
      doc.rect(leftX, ty, leftColWidth, rowH).fillAndStroke(bg, '#CBD5E1');

      // Visual blue data bar inside Percentage cell
      const pctCellX = leftX + wIssue + wCount;
      const barMaxW = wPct - 38;
      const barW = cat.percentage > 0 ? Math.max(2, (cat.percentage / maxPct) * barMaxW) : 0;
      if (barW > 0) {
        doc.rect(pctCellX + 4, ty + 3, barW, rowH - 6).fill('#7FAAD9');
        doc.rect(pctCellX + 4, ty + 3, Math.min(barW, 3), rowH - 6).fill('#2B5B84');
      }

      doc.fillColor('#0F172A').font('Helvetica').fontSize(7.5);
      doc.text(cat.category, leftX + 5, ty + 5, {
        width: wIssue - 8,
        ellipsis: true,
        lineBreak: false,
      });
      doc.text(String(cat.count), leftX + wIssue + 2, ty + 5, {
        width: wCount - 4,
        align: 'center',
      });
      doc.text(`${cat.percentage.toFixed(1)}%`, pctCellX + 2, ty + 5, {
        width: wPct - 8,
        align: 'right',
      });
      doc.text(String(cat.rank), leftX + wIssue + wCount + wPct + 2, ty + 5, {
        width: wRank - 4,
        align: 'center',
      });
      ty += rowH;
    });

    // TOTAL Row
    doc.rect(leftX, ty, leftColWidth, 20).fillAndStroke('#DCE6F1', '#17324D');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTAL', leftX + 5, ty + 6, { width: wIssue - 10 });
    doc.text(String(stats.eligible_complaints), leftX + wIssue + 2, ty + 6, {
      width: wCount - 4,
      align: 'center',
    });
    doc.text(
      stats.eligible_complaints > 0 ? '100.0%' : '0.0%',
      leftX + wIssue + wCount + 2,
      ty + 6,
      { width: wPct - 8, align: 'right' }
    );

    // 4. Right Column: Multi-Color Horizontal Bar Chart ("Complaints by Issue Type")
    const chartX = leftX + leftColWidth + 16;
    const chartWidth = pageWidth - leftColWidth - 16;
    const chartTop = kpiY;
    const chartHeight = Math.max(260, ty + 20 - chartTop);

    doc.rect(chartX, chartTop, chartWidth, chartHeight).fillAndStroke('#FFFFFF', '#CBD5E1');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10.5);
    doc.text('Complaints by Issue Type', chartX, chartTop + 10, {
      width: chartWidth,
      align: 'center',
    });

    const labelColW = 112;
    const valueColW = 58;
    const plotX = chartX + labelColW + 8;
    const plotW = chartWidth - labelColW - valueColW - 18;
    const plotY = chartTop + 32;
    const plotH = chartHeight - 60;

    const maxCount = Math.max(1, ...stats.category_summary.map((c) => c.count));
    const axisMax = Math.max(4, Math.ceil(maxCount / 4) * 4);

    // Vertical Gridlines & X-axis Ticks
    for (let t = 0; t <= 4; t++) {
      const gx = plotX + (plotW * t) / 4;
      doc
        .moveTo(gx, plotY)
        .lineTo(gx, plotY + plotH)
        .strokeColor(t === 0 ? '#64748B' : '#E2E8F0')
        .lineWidth(t === 0 ? 1 : 0.75)
        .stroke();
      doc.fillColor('#475569').font('Helvetica').fontSize(7);
      doc.text(String(Math.round((axisMax * t) / 4)), gx - 16, plotY + plotH + 4, {
        width: 32,
        align: 'center',
      });
    }
    doc.fillColor('#334155').font('Helvetica-Bold').fontSize(7.5);
    doc.text('Number of Complaints', plotX, plotY + plotH + 15, {
      width: plotW,
      align: 'center',
    });

    const barPitch = stats.category_summary.length > 0 ? plotH / stats.category_summary.length : 20;
    const barThickness = Math.max(8, Math.min(16, barPitch - 5));

    stats.category_summary.forEach((cat, idx) => {
      const by = plotY + idx * barPitch + (barPitch - barThickness) / 2;
      const barLen = cat.count > 0 ? Math.max(3, (cat.count / axisMax) * plotW) : 0;
      const barColor = CHART_PALETTE[idx % CHART_PALETTE.length];

      doc.fillColor('#1E293B').font('Helvetica').fontSize(7);
      doc.text(cat.category, chartX + 6, by + 1, {
        width: labelColW - 4,
        align: 'right',
        ellipsis: true,
        lineBreak: false,
      });

      if (barLen > 0) {
        doc.rect(plotX, by, barLen, barThickness).fill(barColor);
      }

      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7);
      doc.text(
        `${cat.count} (${cat.percentage.toFixed(1)}%)`,
        plotX + barLen + 4,
        by + 1,
        { width: valueColW + 10, lineBreak: false }
      );
    });

    // Bottom footer note
    doc.fillColor('#475569').font('Helvetica').fontSize(7.5);
    doc.text(
      `Total Processed: ${stats.total_complaints}   |   Classified: ${stats.classified_count}   |   Review Required: ${stats.review_count}   |   Empty Text: ${stats.empty_count}   |   Candidate Groups: ${stats.candidate_groups_count}`,
      leftX,
      doc.page.height - 46,
      { width: pageWidth }
    );

    // =========================================================================
    // Page 2+: Detailed Classification Results Table
    // =========================================================================
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 28 });

    const colWidths = [36, 305, 165, 60, 80, 140];
    const colHeaders = [
      'S/N',
      'Complaint Description',
      'Predicted Category',
      'Confidence',
      'Status',
      'Candidate Group',
    ];

    const drawResultsHeader = (yPos: number): number => {
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(12);
      doc.text('Detailed Complaint Results', leftX, yPos);
      const headerY = yPos + 18;
      doc.rect(leftX, headerY, pageWidth, 22).fill('#17324D');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8.5);
      let x = leftX;
      colHeaders.forEach((h, i) => {
        doc.text(h, x + 6, headerY + 7, { width: colWidths[i] - 10 });
        x += colWidths[i];
      });
      return headerY + 22;
    };

    let rowY = drawResultsHeader(28);
    const maxPageY = doc.page.height - 46;

    results.forEach((r, idx) => {
      const descText = r.complaint_text || '(Empty complaint description)';
      doc.font('Helvetica').fontSize(8);
      const textHeight = doc.heightOfString(descText, { width: colWidths[1] - 12 });
      const rowHeight = Math.max(20, Math.min(76, textHeight + 10));

      if (rowY + rowHeight > maxPageY) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 28 });
        rowY = drawResultsHeader(28);
      }

      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F2F6FA';
      doc.rect(leftX, rowY, pageWidth, rowHeight).fillAndStroke(bg, '#E2E8F0');

      const cells = [
        String(r.row_index),
        descText,
        r.predicted_category || '-',
        r.classification_status === 'Empty Text'
          ? '-'
          : `${(r.confidence_score * 100).toFixed(1)}%`,
        r.classification_status,
        r.candidate_group || '-',
      ];

      let x = leftX;
      doc.fillColor('#1E293B').font('Helvetica').fontSize(8);
      cells.forEach((val, i) => {
        doc.text(val, x + 6, rowY + 5, {
          width: colWidths[i] - 12,
          height: rowHeight - 6,
          ellipsis: true,
        });
        x += colWidths[i];
      });

      rowY += rowHeight;
    });

    // Stamp page numbers across all buffered pages
    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#64748B').font('Helvetica').fontSize(8);
      doc.text(
        `Customer Complaint Categorization Report  |  Analysis #${analysis.id}`,
        leftX,
        doc.page.height - 24,
        { lineBreak: false }
      );
      doc.text(
        `Page ${i + 1} of ${pageRange.count}`,
        leftX + pageWidth - 90,
        doc.page.height - 24,
        { width: 90, align: 'right', lineBreak: false }
      );
    }

    doc.end();
  });
}
