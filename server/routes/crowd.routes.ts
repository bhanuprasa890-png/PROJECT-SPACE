import { Router } from 'express';
import { getDb } from '../db/client';
import { listHotspots, listLatestReadings, listRecentObservations } from '../repositories/crowd.repo';
import { buildForecastSeries } from '../services/crowd-model';
import { listLines, listStops } from '../repositories/network.repo';

export const crowdRouter = Router();

/** Network-wide live crowding, sorted worst first. */
crowdRouter.get('/crowd/live', async (req, res) => {
  const db = await getDb();
  const limit = Number(req.query.limit ?? 200);
  const [readings, hotspots, lines, stops] = await Promise.all([
    listLatestReadings(db, { limit }),
    listHotspots(db, 8),
    listLines(db),
    listStops(db, { limit: 100 }),
  ]);

  res.json({
    generatedAt: new Date().toISOString(),
    readings,
    hotspots,
    lines: lines.map((line) => ({ id: line.id, code: line.code, color: line.color })),
    stops: stops.map((stop) => ({ id: stop.id, name: stop.name, code: stop.code })),
  });
});

crowdRouter.get('/crowd/forecast', async (req, res) => {
  const db = await getDb();
  const lineId = String(req.query.lineId ?? '');
  const stopId = String(req.query.stopId ?? '');
  const horizon = Number(req.query.horizon ?? 120);

  if (!lineId || !stopId) {
    res.status(400).json({
      error: { message: '`lineId` and `stopId` are required', code: 'MISSING_PARAMETERS' },
    });
    return;
  }

  const forecast = await buildForecastSeries(db, {
    lineIdOrCode: lineId,
    stopId,
    horizonMinutes: horizon,
  });

  if (!forecast) {
    res.status(404).json({ error: { message: 'No data for that line/stop', code: 'NOT_FOUND' } });
    return;
  }

  res.json(forecast);
});

crowdRouter.get('/crowd/history', async (req, res) => {
  const db = await getDb();
  const lineId = String(req.query.lineId ?? '');
  const stopId = String(req.query.stopId ?? '');
  const hours = Number(req.query.hours ?? 24);

  if (!lineId || !stopId) {
    res.status(400).json({
      error: { message: '`lineId` and `stopId` are required', code: 'MISSING_PARAMETERS' },
    });
    return;
  }

  res.json({
    lineId,
    stopId,
    hours,
    observations: await listRecentObservations(db, { lineId, stopId, hours, limit: 120 }),
  });
});
