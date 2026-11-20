import fs from 'fs';
import { config } from '../config.ts';
import type { TrainedComplaintModel } from './modeling.ts';

let cachedModel: TrainedComplaintModel | null = null;
let cachedModelPath: string | null = null;

export function loadTrainedModel(customPath?: string): TrainedComplaintModel {
  const targetPath = customPath || config.modelPath;
  if (cachedModel && cachedModelPath === targetPath) {
    return cachedModel;
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(
      `Trained ML model artifact not found at ${targetPath}. Please place the trained model file before running analyses.`
    );
  }

  const raw = fs.readFileSync(targetPath, 'utf-8');
  const parsed = JSON.parse(raw) as TrainedComplaintModel;

  if (
    !Array.isArray(parsed.categories) ||
    !parsed.vocabulary ||
    !Array.isArray(parsed.idf) ||
    !Array.isArray(parsed.weights) ||
    !Array.isArray(parsed.biases) ||
    !Array.isArray(parsed.centroids)
  ) {
    throw new Error('Trained ML model artifact is malformed or missing required parameters.');
  }

  cachedModel = parsed;
  cachedModelPath = targetPath;
  return cachedModel;
}

export function clearModelCache(): void {
  cachedModel = null;
  cachedModelPath = null;
}
