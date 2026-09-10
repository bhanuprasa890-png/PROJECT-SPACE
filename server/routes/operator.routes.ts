import { Router } from 'express';
import { getDb } from '../db/client';
import { buildOperatorOverview } from '../services/operator';
import { listFleet, listLineLoad } from '../repositories/operator.repo';
import { listDemandSignals } from '../repositories/searches.repo';
import { getAllConfig } from '../repositories/config.repo';

export const operatorRouter = Router();

/** Everything the control room needs in a single round trip. */
operatorRouter.get('/operator/overview', async (req, res) => {
  const db = await getDb();
  const windowHours = Number(req.query.window ?? 24);
  res.json(await buildOperatorOverview(db, Number.isFinite(windowHours) ? windowHours : 24));
});

operatorRouter.get('/operator/fleet', async (_req, res) => {
  const db = await getDb();
  res.json({ fleet: await listFleet(db) });
});

operatorRouter.get('/operator/line-load', async (req, res) => {
  const db = await getDb();
  const dayType = String(req.query.dayType ?? 'weekday');
  res.json({ dayType, lines: await listLineLoad(db, dayType) });
});

operatorRouter.get('/operator/demand', async (req, res) => {
  const db = await getDb();
  const windowDays = Number(req.query.days ?? 14);
  res.json({
    windowDays,
    signals: await listDemandSignals(db, { windowDays, limit: Number(req.query.limit ?? 10) }),
  });
});

/** Model and planner configuration, surfaced read-only to the UI. */
operatorRouter.get('/operator/config', async (_req, res) => {
  const db = await getDb();
  res.json({ config: await getAllConfig(db) });
});
