import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../security.ts';
import { generateExcelReport, generatePdfReport } from '../reporting/reportService.ts';

const router = Router();
router.use(requireAuth);

router.get('/:analysisId/excel', async (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  try {
    const { buffer, filename } = await generateExcelReport(req.user!.id, analysisId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate Excel report.';
    const status = msg === 'Analysis not found.' ? 404 : 400;
    res.status(status).json({ detail: msg });
  }
});

router.get('/:analysisId/pdf', async (req: AuthenticatedRequest, res) => {
  const analysisId = Number(req.params.analysisId);
  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ detail: 'Invalid analysis ID.' });
    return;
  }

  try {
    const { buffer, filename } = await generatePdfReport(req.user!.id, analysisId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate PDF report.';
    const status = msg === 'Analysis not found.' ? 404 : 400;
    res.status(status).json({ detail: msg });
  }
});

export default router;
