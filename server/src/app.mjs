/**
 * Express app factory. Exported separately from the listener so tests can boot
 * the exact production app on an ephemeral port.
 */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.mjs';
import { attachSession, createRateLimiter, requireAuth, requireCsrf, securityHeaders } from './http.mjs';
import { getDb } from './db.mjs';
import { seedDatabase } from './seed.mjs';
import { authRouter } from './routes/auth.mjs';
import kitchenRouter from './routes/kitchen.mjs';

export function createApp({ seed = true } = {}) {
  getDb();
  if (seed && !config.IS_PROD) seedDatabase();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(attachSession);

  const apiLimiter = createRateLimiter({ max: 240 });
  app.use('/api', apiLimiter('api'));
  app.use('/api', requireCsrf);
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: config.NODE_ENV, googleMode: config.google.mode, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  // Everything below the auth surface is gated: the recipe cards, copilots and
  // personal stats only exist for a signed-in session.
  app.use('/api', requireAuth, kitchenRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));

  // Serve the built client when it exists (single-process deployment).
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: config.IS_PROD ? '1h' : 0 }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  } else {
    app.get('*', (_req, res) => {
      res
        .status(200)
        .type('html')
        .send(
          `<!doctype html><html><body style="font-family:system-ui;background:#100E0C;color:#FFF8F1;padding:40px">
           <h2>Mise API is running</h2>
           <p>The client bundle is not built yet. Run <code>npm run dev</code> (Vite on :5173) or <code>npm run build && npm start</code>.</p>
           <p><a style="color:#FF8A3D" href="/api/health">/api/health</a></p></body></html>`
        );
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    console.error('[app-error]', error?.message || error);
    if (res.headersSent) return next(error);
    res.status(error?.statusCode || 500).json({ error: config.IS_PROD ? 'Server error.' : String(error?.message || error) });
  });

  return app;
}
