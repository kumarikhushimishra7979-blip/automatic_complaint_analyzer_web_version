import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { config } from '../config.ts';
import { requireAuth, type AuthenticatedRequest } from '../security.ts';
import {
  configureDatasetColumns,
  deleteUserDataset,
  getUserDatasetById,
  importSampleDatasetForUser,
  listUserDatasets,
  previewUserDataset,
  registerUploadedDataset,
} from '../services/datasetService.ts';
import { isAllowedExtension } from '../utils/fileUtils.ts';

const router = Router();

const stagingDir = path.resolve(config.uploadDir, '_staging');
fs.mkdirSync(stagingDir, { recursive: true });

const upload = multer({
  dest: stagingDir,
  limits: {
    fileSize: config.maxUploadSizeBytes,
  },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedExtension(file.originalname)) {
      cb(new Error('Unsupported file type. Only .csv and .xlsx files are allowed.'));
      return;
    }
    cb(null, true);
  },
});

router.use(requireAuth);

router.post('/upload', upload.single('file'), (req: AuthenticatedRequest, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ detail: 'Please select a .csv or .xlsx file to upload.' });
      return;
    }

    const { dataset, headers } = registerUploadedDataset(
      req.user!.id,
      req.file.path,
      req.file.originalname,
      req.file.size
    );

    res.status(201).json({
      message: 'Dataset uploaded successfully.',
      dataset: {
        ...dataset,
        storage_path: undefined,
      },
      headers,
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({
      detail: err instanceof Error ? err.message : 'Failed to process uploaded dataset.',
    });
  }
});

router.post('/import-sample', (req: AuthenticatedRequest, res) => {
  try {
    const { dataset, headers } = importSampleDatasetForUser(req.user!.id);
    res.status(201).json({
      message: 'Sample customer complaint dataset imported successfully.',
      dataset: {
        ...dataset,
        storage_path: undefined,
      },
      headers,
    });
  } catch (err) {
    res.status(500).json({
      detail: err instanceof Error ? err.message : 'Failed to import sample dataset.',
    });
  }
});

router.get('/', (req: AuthenticatedRequest, res) => {
  const datasets = listUserDatasets(req.user!.id).map((d) => ({
    ...d,
    storage_path: undefined,
  }));
  res.json({ items: datasets });
});

router.get('/:datasetId', (req: AuthenticatedRequest, res) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    res.status(400).json({ detail: 'Invalid dataset ID.' });
    return;
  }

  const dataset = getUserDatasetById(req.user!.id, datasetId);
  if (!dataset) {
    res.status(404).json({ detail: 'Dataset not found.' });
    return;
  }

  res.json({ ...dataset, storage_path: undefined });
});

router.get('/:datasetId/preview', (req: AuthenticatedRequest, res) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    res.status(400).json({ detail: 'Invalid dataset ID.' });
    return;
  }

  try {
    const preview = previewUserDataset(req.user!.id, datasetId);
    res.json({
      dataset: { ...preview.dataset, storage_path: undefined },
      headers: preview.headers,
      total_rows: preview.total_rows,
      rows: preview.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to preview dataset.';
    const status = message === 'Dataset not found.' ? 404 : 400;
    res.status(status).json({ detail: message });
  }
});

router.put('/:datasetId/columns', (req: AuthenticatedRequest, res) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    res.status(400).json({ detail: 'Invalid dataset ID.' });
    return;
  }

  const { complaint_column, category_column } = req.body || {};

  try {
    const updated = configureDatasetColumns(
      req.user!.id,
      datasetId,
      complaint_column,
      category_column || null
    );
    res.json({
      message: 'Column configuration saved successfully.',
      dataset: { ...updated, storage_path: undefined },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save column configuration.';
    const status = message === 'Dataset not found.' ? 404 : 400;
    res.status(status).json({ detail: message });
  }
});

router.delete('/:datasetId', (req: AuthenticatedRequest, res) => {
  const datasetId = Number(req.params.datasetId);
  if (!Number.isInteger(datasetId) || datasetId <= 0) {
    res.status(400).json({ detail: 'Invalid dataset ID.' });
    return;
  }

  try {
    deleteUserDataset(req.user!.id, datasetId);
    res.json({ message: 'Dataset deleted successfully.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete dataset.';
    const status = message === 'Dataset not found.' ? 404 : 400;
    res.status(status).json({ detail: message });
  }
});

export default router;
