import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client';
import {
  alertSeverityBreakdown,
  createAlert,
  deleteAlert,
  getAlert,
  listAlerts,
  updateAlertStatus,
} from '../repositories/alerts.repo';
import { getAgency } from '../repositories/network.repo';
import type { AlertCategory, AlertSeverity } from '../../shared/types';

export const alertsRouter = Router();

const createSchema = z.object({
  lineId: z.string().nullable().optional(),
  stopId: z.string().nullable().optional(),
  severity: z.enum(['info', 'minor', 'major', 'critical']),
  category: z.enum(['crowding', 'delay', 'disruption', 'service_change', 'weather', 'maintenance']),
  title: z.string().min(4).max(120),
  body: z.string().min(8).max(1200),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  issuedBy: z.string().max(80).optional(),
});

alertsRouter.get('/alerts', async (req, res) => {
  const db = await getDb();
  const status = req.query.status ? String(req.query.status) : 'all';
  const [alerts, breakdown] = await Promise.all([
    listAlerts(db, {
      status: status as 'active' | 'scheduled' | 'resolved' | 'all',
      severity: req.query.severity ? (String(req.query.severity) as AlertSeverity) : undefined,
      lineId: req.query.lineId ? String(req.query.lineId) : undefined,
      stopId: req.query.stopId ? String(req.query.stopId) : undefined,
      limit: Number(req.query.limit ?? 50),
    }),
    alertSeverityBreakdown(db),
  ]);

  res.json({ alerts, count: alerts.length, severityBreakdown: breakdown });
});

alertsRouter.get('/alerts/:alertId', async (req, res) => {
  const db = await getDb();
  const alert = await getAlert(db, req.params.alertId);
  if (!alert) {
    res.status(404).json({ error: { message: 'Alert not found', code: 'ALERT_NOT_FOUND' } });
    return;
  }
  res.json(alert);
});

/** Publishers used by the operator console to push a rider-facing notice. */
alertsRouter.post('/alerts', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: 'Invalid alert payload', code: 'VALIDATION_ERROR', details: parsed.error.issues },
    });
    return;
  }

  const db = await getDb();
  const agency = await getAgency(db);
  if (!agency) {
    res.status(503).json({ error: { message: 'No agency configured', code: 'NO_AGENCY' } });
    return;
  }

  const alert = await createAlert(db, agency.id, {
    ...parsed.data,
    category: parsed.data.category as AlertCategory,
    severity: parsed.data.severity as AlertSeverity,
    issuedBy: parsed.data.issuedBy ?? 'Control Room',
  });

  res.status(201).json(alert);
});

/** Retract a notice that should never have been published. */
alertsRouter.delete('/alerts/:alertId', async (req, res) => {
  const db = await getDb();
  const removed = await deleteAlert(db, req.params.alertId);
  if (!removed) {
    res.status(404).json({ error: { message: 'Alert not found', code: 'ALERT_NOT_FOUND' } });
    return;
  }
  res.status(204).end();
});

alertsRouter.patch('/alerts/:alertId', async (req, res) => {
  const schema = z.object({ status: z.enum(['active', 'scheduled', 'resolved']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: 'Invalid status update', code: 'VALIDATION_ERROR', details: parsed.error.issues },
    });
    return;
  }

  const db = await getDb();
  const alert = await updateAlertStatus(db, req.params.alertId, parsed.data.status);
  if (!alert) {
    res.status(404).json({ error: { message: 'Alert not found', code: 'ALERT_NOT_FOUND' } });
    return;
  }
  res.json(alert);
});
