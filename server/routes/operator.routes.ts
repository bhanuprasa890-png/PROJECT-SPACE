import { Router } from 'express';
import { getDb } from '../db/client';
import { buildOperatorOverview } from '../services/operator';
import { buildCommandCenter } from '../services/command-center';
import { applyDecision, buildDecisionProposal } from '../services/ai-decision';
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

/**
 * The Operator Command Center: network overview, live route status, crowd
 * heatmap, AI alerts, AI recommendations and route analytics in one payload.
 * Everything is aggregated from Postgres and the prediction layer.
 */
operatorRouter.get('/operator/command-center', async (_req, res) => {
  const db = await getDb();
  res.json(await buildCommandCenter(db));
});

/**
 * The AI decision behind one route: the congestion event the engine detects next
 * (live reading, engine scan or the route's recurring peak window), the numbered
 * actions it recommends and the projected impact with and without them.
 */
operatorRouter.get('/operator/ai-decision', async (req, res) => {
  const line = String(req.query.line ?? req.query.lineId ?? '').trim();
  if (!line) {
    res.status(400).json({
      error: {
        message: 'Provide ?line=<route id or code>, for example ?line=21G',
        code: 'MISSING_PARAMETERS',
      },
    });
    return;
  }

  const db = await getDb();
  const decision = await buildDecisionProposal(db, { lineIdOrCode: line });
  if (!decision) {
    res.status(404).json({
      error: { message: `No route matches "${line}"`, code: 'ROUTE_NOT_FOUND' },
    });
    return;
  }

  res.json({ decision, simulated: true, generatedAt: decision.generatedAt });
});

/**
 * Apply the AI recommendation. One transaction writes the decision ledger
 * (`ai_decisions` + `ai_decision_actions`), releases a reserve vehicle onto the
 * route and raises the rider-facing `alerts` event; the command centre is then
 * refetched by the console, so the dashboard shows the new reality.
 */
operatorRouter.post('/operator/ai-decision/apply', async (req, res) => {
  const body = (req.body ?? {}) as {
    lineId?: string;
    line?: string;
    appliedBy?: string;
    force?: boolean;
  };
  const line = String(body.lineId ?? body.line ?? '').trim();
  if (!line) {
    res.status(400).json({
      error: { message: 'Provide lineId (route id or code)', code: 'MISSING_PARAMETERS' },
    });
    return;
  }

  const db = await getDb();
  const outcome = await applyDecision(db, {
    lineIdOrCode: line,
    appliedBy: body.appliedBy?.trim() || undefined,
    force: body.force === true,
  });

  if (!outcome) {
    res.status(404).json({
      error: { message: `No route matches "${line}"`, code: 'ROUTE_NOT_FOUND' },
    });
    return;
  }
  if (outcome.conflict) {
    res.status(409).json({
      error: { message: outcome.conflict.message, code: 'INTERVENTION_ALREADY_APPLIED' },
      intervention: outcome.conflict.intervention,
    });
    return;
  }

  res.status(201).json(outcome.result);
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
