import { Router } from 'express';
import { z } from 'zod';
import { getDb, driverName } from '../db/client';
import { env } from '../config/env';
import { getNetworkCounts, listFleetStats } from '../repositories/operator.repo';
import { listDatasetTables } from '../repositories/dataset.repo';
import type { HealthReport } from '../../shared/types';

export const healthRouter = Router();

const startedAt = Date.now();

/**
 * `/api/health` — proves the stack end to end: which database driver is in use,
 * how long queries take, the schema version and live table counts.
 */
healthRouter.get('/health', async (_req, res) => {
  const db = await getDb();
  const started = performance.now();

  const [version, counts, fleet, dataset] = await Promise.all([
    db.one<{ version: string }>(
      `select version from schema_migrations where version like 'migrations/%'
       order by version desc limit 1`,
    ),
    getNetworkCounts(db),
    listFleetStats(db),
    listDatasetTables(db),
  ]);

  // Canonical demo dataset counts (routes, stops, vehicles, predictions, …)
  const datasetRows = Object.fromEntries(
    dataset.filter((table) => table.kind === 'table').map((table) => [table.name, table.rowCount]),
  );

  const latencyMs = Math.round((performance.now() - started) * 100) / 100;

  const payload: HealthReport & {
    uptimeSeconds: number;
    defaults: { profileId: string };
    dataClassification: 'demo-simulated';
    dataset: { name: string; requestedAs: string; rows: number }[];
  } = {
    status: 'ok',
    service: 'transitpulse-ai-api',
    version: env.appVersion,
    database: {
      driver: driverName(),
      connected: true,
      latencyMs,
      schemaVersion: version?.version ?? null,
      rows: { ...counts, vehicles: fleet.total, ...datasetRows },
    },
    modelVersion: env.modelVersion,
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    defaults: { profileId: env.defaultProfileId },
    dataClassification: 'demo-simulated',
    dataset: dataset.map((table) => ({
      name: table.name,
      requestedAs: table.requestedAs,
      rows: table.rowCount,
    })),
  };

  res.json(payload);
});

const echoSchema = z.object({ message: z.string().min(1) });

healthRouter.post('/health/echo', (req, res) => {
  const parsed = echoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: 'Invalid payload', code: 'VALIDATION_ERROR', details: parsed.error.issues },
    });
    return;
  }
  res.json({ ok: true, echo: parsed.data.message, receivedAt: new Date().toISOString() });
});
