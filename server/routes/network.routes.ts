import { Router } from 'express';
import { getDb } from '../db/client';
import {
  getAgency,
  getLineDetail,
  getStop,
  listDepartures,
  listLines,
  listStops,
} from '../repositories/network.repo';
import { alertsForLine } from '../repositories/alerts.repo';
import { CrowdModel } from '../services/crowd-model';
import { getConfig, MODEL_DEFAULTS, type CrowdModelConfig } from '../repositories/config.repo';

export const networkRouter = Router();

networkRouter.get('/network', async (_req, res) => {
  const db = await getDb();
  const [agency, stops, lines, config] = await Promise.all([
    getAgency(db),
    listStops(db, { limit: 500 }),
    listLines(db),
    getConfig<CrowdModelConfig>(db, 'crowd_model', MODEL_DEFAULTS),
  ]);

  res.json({ agency, stops, lines, model: { version: config.version, accuracy: config.accuracy } });
});

networkRouter.get('/stops', async (req, res) => {
  const db = await getDb();
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;
  const limit = Number(req.query.limit ?? 200);
  const interchangeOnly = req.query.interchange === 'true';

  const stops = await listStops(db, { q: query, limit, interchangeOnly });
  res.json({ stops, count: stops.length });
});

networkRouter.get('/stops/:stopId', async (req, res) => {
  const db = await getDb();
  const stop = await getStop(db, req.params.stopId);
  if (!stop) {
    res.status(404).json({ error: { message: 'Stop not found', code: 'STOP_NOT_FOUND' } });
    return;
  }

  const horizon = Number(req.query.horizon ?? 60);
  const [departures, model] = await Promise.all([
    listDepartures(db, stop.id, new Date().toISOString(), horizon),
    CrowdModel.load(db),
  ]);

  res.json({
    stop,
    departures: departures.map((departure) => {
      const prediction = model.predict({
        lineId: departure.lineId,
        stopId: stop.id,
        at: new Date(departure.departureAt),
        capacity: departure.vehicleCapacity || 90,
        mode: departure.mode,
        headwayMinutes: departure.headwayMinutes,
      });
      return {
        ...departure,
        prediction: {
          ratio: prediction.ratio,
          level: prediction.level,
          headcount: prediction.headcount,
          capacity: departure.vehicleCapacity || 90,
          confidence: prediction.confidence,
        },
      };
    }),
  });
});

networkRouter.get('/lines', async (_req, res) => {
  const db = await getDb();
  const lines = await listLines(db);
  res.json({ lines });
});

networkRouter.get('/lines/:lineId', async (req, res) => {
  const db = await getDb();
  const detail = await getLineDetail(db, req.params.lineId);
  if (!detail) {
    res.status(404).json({ error: { message: 'Line not found', code: 'LINE_NOT_FOUND' } });
    return;
  }
  const activeAlerts = await alertsForLine(db, detail.line.id);
  res.json({ ...detail, activeAlerts });
});
