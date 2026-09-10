import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { apiRouter } from './routes';
import { env } from './config/env';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // The Vite dev server proxies /api, but the API is also usable directly
  // (preview deployments, curl, the operator CLI). Reflecting the origin keeps
  // the proxied preview host working without a hardcoded allowlist.
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.get('/', (_req, res) => {
    res.json({
      service: 'TransitPulse AI API',
      docs: '/api/health',
      endpoints: [
        'GET /api/health',
        'GET /api/network',
        'GET /api/stops/:stopId',
        'GET /api/lines/:lineId',
        'GET|POST /api/plan',
        'GET /api/journey-context',
        'GET /api/crowd/live',
        'GET /api/crowd/forecast',
        'GET /api/alerts',
        'GET /api/operator/overview',
        'GET /api/dashboard',
        'GET /api/settings/options',
      ],
    });
  });

  app.use('/api', apiRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { message: 'Endpoint not found', code: 'NOT_FOUND' } });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as Error & { status?: number }).status ?? 500;
    if (status >= 500) {
      console.error('[api] unhandled error:', error);
    }
    res.status(status).json({
      error: {
        message: error.message || 'Unexpected server error',
        code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
        ...(env.nodeEnv === 'development' && status >= 500 ? { details: error.stack } : {}),
      },
    });
  });

  return app;
}
