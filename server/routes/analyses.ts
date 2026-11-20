import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../security.ts';
import {
  cancelUserAnalysis,
  getAnalysisResults,
  getUserAnalysisById,
  listUserAnalyses,
  resetStuckDatasetAnalyses,
  startAnalysis,
} from '../services/analysisService.ts';
import { getAnalysisStatistics } from '../services/statisticsService.ts';

const router = Router();
router.use(requireAuth);

router.post('/:datasetId/run', async (req: AuthenticatedRequest, res) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    res.status(400).json({ detail: 'Invalid dataset ID.' });
    return;
  }

  const thresholdRaw = req.body?.confidence_threshold;
  const threshold =
    thresholdRaw !== undefined && thresholdRaw !== null
      ? Number(thresholdRaw)
      : undefined;

  try {
    const analysis = await startAnalysis(req.user!.id, datasetId, threshold, false);
    res.status(202).json({
      message: 'Complaint analysis initiated.',
      analysisId: analysis.id,
      analysis,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start analysis.';
    const status = msg === 'Dataset not found.' ? 404 : msg.includes('already in progress') ? 409 : 400;
    res.status(status).json({ detail: msg });
  }
});

router.post('/', async (req: AuthenticatedRequest, res) => {
  const datasetId = Number(req.body?.dataset_id ?? req.body?.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    res.status(400).json({ detail: 'Valid dataset_id is required.' });
    return;
  }

  const thresholdRaw = req.body?.confidence_threshold;
  const threshold =
    thresholdRaw !== undefined && thresholdRaw !== null
      ? Number(thresholdRaw)
      : undefined;

  try {
    const analysis = await startAnalysis(req.user!.id, datasetId, threshold, false);
    res.status(202).json({
      message: 'Complaint analysis initiated.',
      analysisId: analysis.id,
      analysis,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start analysis.';
    const status = msg === 'Dataset not found.' ? 404 : msg.includes('already in progress') ? 409 : 400;
    res.status(status).json({ detail: msg });
  }
});

router.get('/', (req: AuthenticatedRequest, res) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.page_size || 20);
  const result = listUserAnalyses(req.user!.id, page, pageSize);
  res.json(result);
});

router.get('/:analysisId', (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  const analysis = getUserAnalysisById(req.user!.id, analysisId);
  if (!analysis) {
    res.status(404).json({ detail: 'Analysis not found.' });
    return;
  }
  res.json(analysis);
});

router.get('/:analysisId/progress', (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  const analysis = getUserAnalysisById(req.user!.id, analysisId);
  if (!analysis) {
    res.status(404).json({ detail: 'Analysis not found.' });
    return;
  }

  res.json({
    analysis_id: analysis.id,
    analysis_status: analysis.analysis_status,
    total_complaints: analysis.total_complaints,
    processed_complaints: analysis.processed_complaints,
    progress_percent: analysis.progress_percent,
    error_message: analysis.error_message,
    started_at: analysis.started_at,
    completed_at: analysis.completed_at,
  });
});

router.get('/:analysisId/results', (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  const results = getAnalysisResults(req.user!.id, analysisId, {
    page: Number(req.query.page || 1),
    pageSize: Number(req.query.page_size || 20),
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    needsReview:
      typeof req.query.needs_review === 'string' ? req.query.needs_review : undefined,
    candidateGroup:
      typeof req.query.candidate_group === 'string'
        ? req.query.candidate_group
        : undefined,
  });

  if (!results) {
    res.status(404).json({ detail: 'Analysis not found.' });
    return;
  }

  res.json(results);
});

router.get('/:analysisId/statistics', (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  const stats = getAnalysisStatistics(req.user!.id, analysisId);
  if (!stats) {
    res.status(404).json({ detail: 'Analysis not found.' });
    return;
  }

  res.json(stats);
});

router.post('/dataset/:datasetId/reset', (req: AuthenticatedRequest, res) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    res.status(400).json({ detail: 'Invalid dataset ID.' });
    return;
  }

  try {
    const resetCount = resetStuckDatasetAnalyses(req.user!.id, datasetId);
    res.json({
      message:
        resetCount > 0
          ? `Reset ${resetCount} stuck analysis job(s) for this dataset.`
          : 'No stuck analyses were running for this dataset.',
      dataset_id: datasetId,
      reset_count: resetCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reset dataset analyses.';
    res.status(msg === 'Dataset not found.' ? 404 : 400).json({ detail: msg });
  }
});

router.post('/:analysisId/cancel', (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  try {
    const analysis = cancelUserAnalysis(req.user!.id, analysisId);
    res.json({
      message: 'Analysis cancelled and reset.',
      analysis,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to cancel analysis.';
    const status =
      msg === 'Analysis not found.' ? 404 : msg.includes('Only Pending or Processing') ? 409 : 400;
    res.status(status).json({ detail: msg });
  }
});

router.post('/:analysisId/reset', (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  try {
    const analysis = cancelUserAnalysis(req.user!.id, analysisId);
    res.json({
      message: 'Analysis reset to Failed.',
      analysis,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reset analysis.';
    const status =
      msg === 'Analysis not found.' ? 404 : msg.includes('Only Pending or Processing') ? 409 : 400;
    res.status(status).json({ detail: msg });
  }
});

export default router;
