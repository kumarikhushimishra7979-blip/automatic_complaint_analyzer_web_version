import { getDb } from '../database.ts';
import { config } from '../config.ts';
import { getUserDatasetById } from './datasetService.ts';
import { readDatasetRowsInBatches } from '../utils/fileUtils.ts';
import {
  assignCandidateGroupsAsync,
  classifyComplaintBatch,
  type ComplaintPredictionOutput,
} from '../ml/mlService.ts';
import { yieldToEventLoop } from '../ml/modeling.ts';
import { safeLog } from '../security.ts';

const cancelledAnalysisIds = new Set<number>();

export function recoverInterruptedAnalyses(): number {
  const db = getDb();
  const res = db
    .prepare(
      `UPDATE analyses
       SET analysis_status = 'Failed',
           error_message = 'Interrupted by server restart',
           completed_at = COALESCE(completed_at, datetime('now'))
       WHERE analysis_status IN ('Pending', 'Processing')`
    )
    .run();
  const changed = Number(res.changes || 0);
  if (changed > 0) {
    safeLog('WARN', 'recovered_interrupted_analyses', { count: changed });
  }
  return changed;
}

export function cancelUserAnalysis(
  userId: number,
  analysisId: number
): AnalysisRecord {
  const analysis = getUserAnalysisById(userId, analysisId);
  if (!analysis) {
    throw new Error('Analysis not found.');
  }
  if (
    analysis.analysis_status !== 'Pending' &&
    analysis.analysis_status !== 'Processing'
  ) {
    throw new Error('Only Pending or Processing analyses can be cancelled or reset.');
  }

  cancelledAnalysisIds.add(analysisId);
  const db = getDb();
  db.prepare(
    `UPDATE analyses
     SET analysis_status = 'Failed',
         error_message = 'Cancelled / reset by user',
         completed_at = COALESCE(completed_at, datetime('now'))
     WHERE id = ? AND user_id = ? AND analysis_status IN ('Pending', 'Processing')`
  ).run(analysisId, userId);

  safeLog('INFO', 'analysis_cancelled', { analysisId, userId });
  const updated = getUserAnalysisById(userId, analysisId);
  if (!updated) {
    throw new Error('Analysis not found after cancellation.');
  }
  return updated;
}

export function resetStuckDatasetAnalyses(
  userId: number,
  datasetId: number
): number {
  const dataset = getUserDatasetById(userId, datasetId);
  if (!dataset) {
    throw new Error('Dataset not found.');
  }

  const db = getDb();
  const activeRows = db
    .prepare(
      `SELECT id FROM analyses
       WHERE dataset_id = ? AND user_id = ? AND analysis_status IN ('Pending', 'Processing')`
    )
    .all(datasetId, userId) as { id: number }[];

  for (const row of activeRows) {
    cancelledAnalysisIds.add(row.id);
  }

  const res = db
    .prepare(
      `UPDATE analyses
       SET analysis_status = 'Failed',
           error_message = 'Cancelled / reset by user',
           completed_at = COALESCE(completed_at, datetime('now'))
       WHERE dataset_id = ? AND user_id = ? AND analysis_status IN ('Pending', 'Processing')`
    )
    .run(datasetId, userId);

  const changed = Number(res.changes || 0);
  if (changed > 0) {
    safeLog('INFO', 'dataset_stuck_analyses_reset', {
      datasetId,
      userId,
      resetCount: changed,
    });
  }
  return changed;
}

export interface AnalysisRecord {
  id: number;
  user_id: number;
  dataset_id: number;
  dataset_name?: string;
  file_format?: string;
  analysis_status: 'Pending' | 'Processing' | 'Completed' | 'Failed';
  total_complaints: number;
  processed_complaints: number;
  progress_percent: number;
  confidence_threshold: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export function listUserAnalyses(
  userId: number,
  page = 1,
  pageSize = 20
): { items: AnalysisRecord[]; total: number; page: number; page_size: number; total_pages: number } {
  const db = getDb();
  const safePage = Math.max(1, page);
  const safeSize = Math.min(100, Math.max(1, pageSize));
  const offset = (safePage - 1) * safeSize;

  const totalRow = db
    .prepare('SELECT COUNT(*) as total FROM analyses WHERE user_id = ?')
    .get(userId) as { total: number };
  const total = Number(totalRow?.total || 0);

  const items = db
    .prepare(
      `SELECT a.*, d.filename as dataset_name, d.file_format as file_format
       FROM analyses a
       JOIN datasets d ON d.id = a.dataset_id
       WHERE a.user_id = ?
       ORDER BY datetime(a.started_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, safeSize, offset) as unknown as AnalysisRecord[];

  return {
    items,
    total,
    page: safePage,
    page_size: safeSize,
    total_pages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

export function getUserAnalysisById(
  userId: number,
  analysisId: number
): AnalysisRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.*, d.filename as dataset_name, d.file_format as file_format
       FROM analyses a
       JOIN datasets d ON d.id = a.dataset_id
       WHERE a.id = ? AND a.user_id = ?`
    )
    .get(analysisId, userId) as AnalysisRecord | undefined;
  return row || null;
}

export interface ResultsQueryOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  status?: string;
  needsReview?: string;
  candidateGroup?: string;
}

export function getAnalysisResults(
  userId: number,
  analysisId: number,
  options: ResultsQueryOptions
) {
  const analysis = getUserAnalysisById(userId, analysisId);
  if (!analysis) {
    return null;
  }

  const db = getDb();
  const safePage = Math.max(1, options.page || 1);
  const safeSize = Math.min(100, Math.max(1, options.pageSize || 20));
  const offset = (safePage - 1) * safeSize;

  const whereClauses: string[] = ['analysis_id = ?'];
  const params: (string | number)[] = [analysisId];

  if (options.search && options.search.trim()) {
    whereClauses.push('LOWER(complaint_text) LIKE ?');
    params.push(`%${options.search.trim().toLowerCase()}%`);
  }
  if (options.category && options.category !== 'ALL') {
    whereClauses.push('predicted_category = ?');
    params.push(options.category);
  }
  if (options.status && options.status !== 'ALL') {
    whereClauses.push('classification_status = ?');
    params.push(options.status);
  }
  if (options.needsReview === 'true') {
    whereClauses.push('needs_review = 1');
  } else if (options.needsReview === 'false') {
    whereClauses.push('needs_review = 0');
  }
  if (options.candidateGroup && options.candidateGroup !== 'ALL') {
    if (options.candidateGroup === 'ANY_GROUP') {
      whereClauses.push("candidate_group IS NOT NULL AND candidate_group != ''");
    } else {
      whereClauses.push('candidate_group = ?');
      params.push(options.candidateGroup);
    }
  }

  const whereSql = whereClauses.join(' AND ');
  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM complaint_results WHERE ${whereSql}`)
    .get(...params) as { total: number };
  const total = Number(countRow?.total || 0);

  const items = db
    .prepare(
      `SELECT id, analysis_id, row_index, complaint_text, existing_category,
              predicted_category, confidence_score, classification_status,
              needs_review, candidate_group, created_at
       FROM complaint_results
       WHERE ${whereSql}
       ORDER BY row_index ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, safeSize, offset);

  return {
    items,
    total,
    page: safePage,
    page_size: safeSize,
    total_pages: Math.max(1, Math.ceil(total / safeSize)),
  };
}

export async function startAnalysis(
  userId: number,
  datasetId: number,
  thresholdOverride?: number,
  runSynchronously = false
): Promise<AnalysisRecord> {
  const dataset = getUserDatasetById(userId, datasetId);
  if (!dataset) {
    throw new Error('Dataset not found.');
  }

  if (!dataset.complaint_column) {
    throw new Error('Please configure the complaint text column before running an analysis.');
  }

  const db = getDb();

  // Prevent accidental duplicate execution of the same active analysis
  const existingActive = db
    .prepare(
      `SELECT id FROM analyses
       WHERE dataset_id = ? AND user_id = ? AND analysis_status IN ('Pending', 'Processing')`
    )
    .get(datasetId, userId);

  if (existingActive) {
    throw new Error('An analysis is already in progress for this dataset.');
  }

  const threshold =
    typeof thresholdOverride === 'number' &&
    thresholdOverride >= 0.1 &&
    thresholdOverride <= 0.9
      ? thresholdOverride
      : config.confidenceThreshold;

  const insertRes = db
    .prepare(
      `INSERT INTO analyses (user_id, dataset_id, analysis_status, total_complaints, processed_complaints, progress_percent, confidence_threshold)
       VALUES (?, ?, 'Pending', ?, 0, 0, ?)`
    )
    .run(userId, datasetId, dataset.total_rows, threshold);

  const analysisId = Number(insertRes.lastInsertRowid);

  if (runSynchronously) {
    await executeAnalysisJob(analysisId, userId, datasetId, threshold);
  } else {
    setImmediate(() => {
      executeAnalysisJob(analysisId, userId, datasetId, threshold).catch((err) => {
        safeLog('ERROR', 'background_analysis_failed', {
          analysisId,
          reason: err instanceof Error ? err.message : 'unknown',
        });
      });
    });
  }

  const created = getUserAnalysisById(userId, analysisId);
  if (!created) {
    throw new Error('Failed to retrieve created analysis.');
  }
  return created;
}

export async function executeAnalysisJob(
  analysisId: number,
  userId: number,
  datasetId: number,
  threshold: number
): Promise<void> {
  const db = getDb();
  const dataset = getUserDatasetById(userId, datasetId);
  if (!dataset || !dataset.complaint_column) {
    db.prepare(
      `UPDATE analyses SET analysis_status = 'Failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`
    ).run('Dataset configuration is missing.', analysisId);
    return;
  }

  const checkCancelled = () => {
    if (cancelledAnalysisIds.has(analysisId)) {
      throw new Error('Cancelled / reset by user');
    }
    const row = db
      .prepare('SELECT analysis_status FROM analyses WHERE id = ?')
      .get(analysisId) as { analysis_status: string } | undefined;
    if (!row || row.analysis_status === 'Failed') {
      throw new Error('Cancelled / reset by user');
    }
  };

  db.prepare(`UPDATE analyses SET analysis_status = 'Processing' WHERE id = ?`).run(
    analysisId
  );
  await yieldToEventLoop();

  const ext = `.${dataset.file_format.toLowerCase()}`;
  const complaintCol = dataset.complaint_column;
  const categoryCol = dataset.category_column;
  const batchSize = 100;

  const insertStmt = db.prepare(
    `INSERT INTO complaint_results
     (analysis_id, row_index, complaint_text, existing_category, predicted_category,
      confidence_score, classification_status, needs_review, candidate_group)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const allPredictions: ComplaintPredictionOutput[] = [];
  let processed = 0;

  try {
    checkCancelled();
    const totalRows = await readDatasetRowsInBatches(
      dataset.storage_path,
      ext,
      batchSize,
      async (batchRows, startIndex) => {
        checkCancelled();
        const inputs = batchRows.map((row, idx) => ({
          rowIndex: startIndex + idx + 1,
          complaintText: row[complaintCol] ?? '',
          existingCategory: categoryCol ? row[categoryCol] || null : null,
        }));

        const batchPreds = classifyComplaintBatch(inputs, threshold);
        allPredictions.push(...batchPreds);

        db.exec('BEGIN TRANSACTION;');
        try {
          for (const p of batchPreds) {
            insertStmt.run(
              analysisId,
              p.rowIndex,
              p.complaintText,
              p.existingCategory,
              p.predictedCategory,
              p.confidenceScore,
              p.classificationStatus,
              p.needsReview ? 1 : 0,
              null
            );
          }
          processed += batchPreds.length;
          const pct =
            dataset.total_rows > 0
              ? Math.min(90, Number(((processed / dataset.total_rows) * 90).toFixed(1)))
              : 90;
          db.prepare(
            `UPDATE analyses SET processed_complaints = ?, progress_percent = ? WHERE id = ?`
          ).run(processed, pct, analysisId);
          db.exec('COMMIT;');
        } catch (err) {
          db.exec('ROLLBACK;');
          throw err;
        }
      }
    );

    // Phase 2: Run async KMeans + cosine similarity candidate group discovery across review complaints
    checkCancelled();
    db.prepare(`UPDATE analyses SET progress_percent = 94 WHERE id = ?`).run(analysisId);
    await yieldToEventLoop();

    const clustered = await assignCandidateGroupsAsync(allPredictions, config.minClusterSize);
    checkCancelled();

    const updateGroupStmt = db.prepare(
      `UPDATE complaint_results SET candidate_group = ? WHERE analysis_id = ? AND row_index = ?`
    );

    db.exec('BEGIN TRANSACTION;');
    try {
      for (const item of clustered) {
        if (item.candidateGroup) {
          updateGroupStmt.run(item.candidateGroup, analysisId, item.rowIndex);
        }
      }
      db.prepare(
        `UPDATE analyses
         SET analysis_status = 'Completed',
             total_complaints = ?,
             processed_complaints = ?,
             progress_percent = 100,
             completed_at = datetime('now')
         WHERE id = ?`
      ).run(totalRows, totalRows, analysisId);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    safeLog('INFO', 'analysis_completed', { analysisId, totalRows });
  } catch (err) {
    const safeMessage =
      err instanceof Error
        ? err.message
        : 'An unexpected error occurred while processing the dataset.';
    db.prepare(
      `UPDATE analyses
       SET analysis_status = 'Failed',
           error_message = ?,
           completed_at = COALESCE(completed_at, datetime('now'))
       WHERE id = ?`
    ).run(safeMessage, analysisId);
    safeLog('ERROR', 'analysis_failed', { analysisId });
  } finally {
    cancelledAnalysisIds.delete(analysisId);
  }
}
