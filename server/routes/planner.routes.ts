import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client';
import { planJourney } from '../services/planner';
import { buildForecastSeries } from '../services/crowd-model';
import { getLineByIdOrCode, getStop } from '../repositories/network.repo';
import { listRecentSearches } from '../repositories/searches.repo';
import { listAlerts } from '../repositories/alerts.repo';
import { env } from '../config/env';

export const plannerRouter = Router();

const planSchema = z.object({
  originStopId: z.string().min(1),
  destinationStopId: z.string().min(1),
  departAfter: z.string().datetime().optional(),
  profileId: z.string().optional(),
  avoidCrowding: z.boolean().optional(),
  crowdTolerance: z.number().min(0).max(1.5).optional(),
  maxTransfers: z.number().int().min(0).max(3).optional(),
  maxWalkMinutes: z.number().int().min(0).max(60).optional(),
  persist: z.boolean().optional(),
});

/**
 * `GET /api/plan?origin=&destination=` — convenience endpoint so journeys can
 * be shared as links. `POST /api/plan` accepts the full planning options.
 */
plannerRouter.get('/plan', async (req, res) => {
  const db = await getDb();
  const originStopId = String(req.query.origin ?? '');
  const destinationStopId = String(req.query.destination ?? '');
  const departAfter = req.query.departAfter ? String(req.query.departAfter) : undefined;
  const profileId = req.query.profileId ? String(req.query.profileId) : env.defaultProfileId;

  if (!originStopId || !destinationStopId) {
    res.status(400).json({
      error: {
        message: 'Both `origin` and `destination` stop identifiers are required',
        code: 'MISSING_PARAMETERS',
      },
    });
    return;
  }

  const result = await planJourney(db, {
    originStopId,
    destinationStopId,
    departAfter,
    profileId,
    avoidCrowding: req.query.avoidCrowding !== 'false',
  });

  if (!result) {
    res.status(404).json({
      error: { message: 'No journey found for those stops', code: 'NO_JOURNEY' },
    });
    return;
  }

  res.json(result);
});

plannerRouter.post('/plan', async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: 'Invalid planning request', code: 'VALIDATION_ERROR', details: parsed.error.issues },
    });
    return;
  }

  const db = await getDb();
  const result = await planJourney(db, {
    ...parsed.data,
    profileId: parsed.data.profileId ?? env.defaultProfileId,
  });

  if (!result) {
    res.status(404).json({
      error: { message: 'No journey found for those stops', code: 'NO_JOURNEY' },
    });
    return;
  }

  res.json(result);
});

plannerRouter.get('/searches/recent', async (req, res) => {
  const db = await getDb();
  const profileId = String(req.query.profileId ?? env.defaultProfileId);
  const limit = Number(req.query.limit ?? 6);
  res.json({ searches: await listRecentSearches(db, profileId, limit) });
});

/**
 * Deep-dive for the Route Details screen: line/stop metadata, the live
 * crowding history, the forward forecast, and anything else a rider needs
 * before boarding.
 */
plannerRouter.get('/journey-context', async (req, res) => {
  const db = await getDb();
  const lineId = String(req.query.lineId ?? '');
  const stopId = String(req.query.stopId ?? '');
  const horizon = Number(req.query.horizon ?? 90);

  if (!lineId || !stopId) {
    res.status(400).json({
      error: { message: '`lineId` and `stopId` are required', code: 'MISSING_PARAMETERS' },
    });
    return;
  }

  const [line, stop, forecast, alerts] = await Promise.all([
    getLineByIdOrCode(db, lineId),
    getStop(db, stopId),
    buildForecastSeries(db, { lineIdOrCode: lineId, stopId, horizonMinutes: horizon }),
    listAlerts(db, { lineId, stopId, limit: 6 }),
  ]);

  if (!line || !stop) {
    res.status(404).json({ error: { message: 'Line or stop not found', code: 'NOT_FOUND' } });
    return;
  }

  res.json({
    line,
    stop,
    forecast,
    alerts: alerts.filter((alert) => alert.status !== 'resolved'),
  });
});
