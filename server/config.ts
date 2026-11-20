import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const ROOT_DIR = process.cwd();

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret:
    process.env.JWT_SECRET ||
    'dev-only-ephemeral-complaint-analysis-secret-key-change-in-prod',
  accessTokenExpireMinutes: Number(
    process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 480
  ),
  databasePath: path.resolve(
    ROOT_DIR,
    process.env.DATABASE_PATH || './backend_data/complaints.db'
  ),
  uploadDir: path.resolve(
    ROOT_DIR,
    process.env.UPLOAD_DIR || './backend_uploads'
  ),
  maxUploadSizeBytes:
    Number(process.env.MAX_UPLOAD_SIZE_MB || 25) * 1024 * 1024,
  modelPath: path.resolve(
    ROOT_DIR,
    process.env.MODEL_PATH || './server/ml/models/trained_model.json'
  ),
  confidenceThreshold: Number(process.env.CONFIDENCE_THRESHOLD || 0.4),
  minClusterSize: Number(process.env.MIN_CLUSTER_SIZE || 2),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export function ensureRuntimeDirectories(): void {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
