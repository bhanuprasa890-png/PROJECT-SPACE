import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client';
import {
  createWatchlistItem,
  deleteWatchlistItem,
  getDefaultProfileId,
  getProfile,
  getSettingsOptions,
  listWatchlist,
  toggleWatchlistItem,
  updateProfile,
} from '../repositories/riders.repo';
import { buildCommuterDashboard } from '../services/dashboard';
import { env } from '../config/env';

export const riderRouter = Router();

const profilePatchSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  email: z.string().email().optional(),
  homeStopId: z.string().nullable().optional(),
  workStopId: z.string().nullable().optional(),
  crowdTolerance: z.number().min(0).max(1.5).optional(),
  maxWalkMinutes: z.number().int().min(0).max(60).optional(),
  maxTransfers: z.number().int().min(0).max(4).optional(),
  preferredModes: z
    .array(z.enum(['metro', 'bus', 'tram', 'brt', 'ferry']))
    .optional(),
  notifyPush: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
  crowdThresholdAlert: z.number().min(0).max(1.5).optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
  theme: z.enum(['dark', 'midnight', 'system']).optional(),
  units: z.enum(['metric', 'imperial']).optional(),
  language: z.string().min(2).max(5).optional(),
  personalizationEnabled: z.boolean().optional(),
});

/** The commuter dashboard payload: stats, next journey, saved journeys, boards. */
riderRouter.get('/dashboard', async (req, res) => {
  const db = await getDb();
  const requested = req.query.profileId ? String(req.query.profileId) : undefined;
  const profileId =
    requested ?? (await getDefaultProfileId(db, env.defaultProfileId)) ?? env.defaultProfileId;

  res.json(await buildCommuterDashboard(db, profileId));
});

riderRouter.get('/profile', async (req, res) => {
  const db = await getDb();
  const profileId = await resolveExistingProfileId(db, req.query.profileId);
  const profile = await getProfile(db, profileId);
  if (!profile) {
    res.status(404).json({ error: { message: 'Profile not found', code: 'PROFILE_NOT_FOUND' } });
    return;
  }
  res.json(profile);
});

riderRouter.patch('/profile', async (req, res) => {
  const parsed = profilePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: 'Invalid preferences', code: 'VALIDATION_ERROR', details: parsed.error.issues },
    });
    return;
  }

  const db = await getDb();
  const profileId = await resolveExistingProfileId(db, req.query.profileId);
  const profile = await updateProfile(db, profileId, parsed.data);
  if (!profile) {
    res.status(404).json({ error: { message: 'Profile not found', code: 'PROFILE_NOT_FOUND' } });
    return;
  }
  res.json(profile);
});

riderRouter.get('/settings/options', async (_req, res) => {
  const db = await getDb();
  res.json(await getSettingsOptions(db));
});

const watchlistSchema = z.object({
  label: z.string().min(2).max(60),
  originStopId: z.string().min(1),
  destinationStopId: z.string().min(1),
  departTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  days: z.array(z.string().min(3).max(3)).min(1).optional(),
  avoidCrowded: z.boolean().optional(),
  notify: z.boolean().optional(),
});

riderRouter.get('/watchlist', async (req, res) => {
  const db = await getDb();
  const profileId = await resolveExistingProfileId(db, req.query.profileId);
  res.json({ items: await listWatchlist(db, profileId) });
});

riderRouter.post('/watchlist', async (req, res) => {
  const parsed = watchlistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { message: 'Invalid saved journey', code: 'VALIDATION_ERROR', details: parsed.error.issues },
    });
    return;
  }
  if (parsed.data.originStopId === parsed.data.destinationStopId) {
    res.status(400).json({
      error: { message: 'Origin and destination must differ', code: 'INVALID_JOURNEY' },
    });
    return;
  }

  const db = await getDb();
  const profileId = await resolveExistingProfileId(db, req.query.profileId);
  const item = await createWatchlistItem(db, profileId, parsed.data);
  res.status(201).json(item);
});

riderRouter.post('/watchlist/:itemId/toggle', async (req, res) => {
  const db = await getDb();
  const profileId = await resolveExistingProfileId(db, req.query.profileId);
  const item = await toggleWatchlistItem(db, profileId, req.params.itemId);
  if (!item) {
    res.status(404).json({ error: { message: 'Saved journey not found', code: 'NOT_FOUND' } });
    return;
  }
  res.json(item);
});

riderRouter.delete('/watchlist/:itemId', async (req, res) => {
  const db = await getDb();
  const profileId = await resolveExistingProfileId(db, req.query.profileId);
  const removed = await deleteWatchlistItem(db, profileId, req.params.itemId);
  if (!removed) {
    res.status(404).json({ error: { message: 'Saved journey not found', code: 'NOT_FOUND' } });
    return;
  }
  res.status(204).end();
});

async function resolveExistingProfileId(
  db: Awaited<ReturnType<typeof getDb>>,
  requested?: unknown,
): Promise<string> {
  const candidate = typeof requested === 'string' && requested ? requested : env.defaultProfileId;
  const profile = await getProfile(db, candidate);
  if (profile) return profile.id;
  const fallback = await getDefaultProfileId(db, candidate);
  return fallback ?? candidate;
}
