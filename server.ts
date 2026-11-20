import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { config, ensureRuntimeDirectories } from './server/config.ts';
import { initDatabase } from './server/database.ts';
import { requireAuth, safeLog, type AuthenticatedRequest } from './server/security.ts';
import authRoutes from './server/routes/auth.ts';
import datasetRoutes from './server/routes/datasets.ts';
import analysisRoutes from './server/routes/analyses.ts';
import reportRoutes from './server/routes/reports.ts';
import { getDashboardSummary } from './server/services/statisticsService.ts';
import { recoverInterruptedAnalyses } from './server/services/analysisService.ts';
import { loadTrainedModel } from './server/ml/modelLoader.ts';

export async function createServerApp() {
  ensureRuntimeDirectories();
  initDatabase();
  recoverInterruptedAnalyses();

  // Warm-load trained ML model artifact once at startup if present
  try {
    loadTrainedModel();
  } catch (err) {
    safeLog('WARN', 'ml_model_preload_warning', {
      msg: err instanceof Error ? err.message : 'model missing',
    });
  }

  const app = express();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (config.nodeEnv === 'development' || config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS policy.'));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'Automatic Customer Complaint Analysis System',
      timestamp: new Date().toISOString(),
    });
  });

  // Dashboard Summary
  app.get('/api/dashboard/summary', requireAuth, (req: AuthenticatedRequest, res) => {
    const summary = getDashboardSummary(req.user!.id);
    res.json(summary);
  });

  // Domain API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/datasets', datasetRoutes);
  app.use('/api/analyses', analysisRoutes);
  app.use('/api/reports', reportRoutes);

  // Unknown /api route handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ detail: 'API endpoint not found.' });
  });

  // Safe global error handler (never leaks stack traces or sensitive paths)
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            detail: `File exceeds the maximum allowed upload size of ${Math.round(
              config.maxUploadSizeBytes / (1024 * 1024)
            )} MB.`,
          });
          return;
        }
        res.status(400).json({ detail: err.message });
        return;
      }

      if (err instanceof Error) {
        res.status(400).json({ detail: err.message });
        return;
      }

      res.status(500).json({ detail: 'An unexpected internal error occurred.' });
    }
  );

  return app;
}

async function start() {
  const app = await createServerApp();

  if (config.nodeEnv !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(config.port, '0.0.0.0', () => {
    safeLog('INFO', 'server_started', { port: config.port, env: config.nodeEnv });
  });
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]).endsWith('server.ts');

if (isMainModule) {
  start().catch((err) => {
    safeLog('ERROR', 'server_boot_failed', {
      msg: err instanceof Error ? err.message : 'unknown',
    });
    process.exit(1);
  });
}
