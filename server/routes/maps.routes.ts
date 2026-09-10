import { Router } from 'express';
import { getDb } from '../db/client';
import {
  MapsKeyMissingError,
  buildJourneyMap,
  buildNetworkMap,
  fetchDirections,
  mapsConfig,
} from '../services/map';
import type { MapPoint } from '@shared/types';

export const mapsRouter = Router();

/**
 * Google Maps layer.
 *
 *   GET /maps/config                    browser key + Directions availability
 *   GET /maps/network                   routes, stops, vehicles, notices
 *   GET /maps/journey                   geometry for the planner's corridors
 *   GET /maps/directions                server-side Directions proxy
 *
 * Only the referrer-restricted browser key ever reaches the browser; the server
 * key stays here and is used exclusively by the Directions proxy.
 */

/** What the browser is allowed to know about the Maps setup. */
mapsRouter.get('/maps/config', (_req, res) => {
  res.json(mapsConfig());
});

/** The whole network in map form — the layer the client draws over Google Maps. */
mapsRouter.get('/maps/network', async (_req, res) => {
  const db = await getDb();
  res.json(await buildNetworkMap(db));
});

/**
 * Geometry for the corridors a planned journey can use. The journey planner
 * payload stays the source of truth for the options; this only adds coordinates
 * and live state per stop so the client can draw them.
 */
mapsRouter.get('/maps/journey', async (req, res) => {
  const origin = String(req.query.origin ?? req.query.originStopId ?? '').trim();
  const destination = String(req.query.destination ?? req.query.destinationStopId ?? '').trim();

  if (!origin || !destination) {
    res.status(400).json({
      error: {
        message: 'Provide ?origin=<stop id>&destination=<stop id>',
        code: 'MISSING_PARAMETERS',
      },
    });
    return;
  }

  const db = await getDb();
  const payload = await buildJourneyMap(db, {
    originStopId: origin,
    destinationStopId: destination,
    departAfter: req.query.departAfter ? String(req.query.departAfter) : undefined,
    avoidCrowding: req.query.avoidCrowding === undefined ? undefined : req.query.avoidCrowding !== 'false',
    maxTransfers: req.query.maxTransfers === undefined ? undefined : Number(req.query.maxTransfers),
  });

  if (!payload) {
    res.status(404).json({
      error: {
        message: `No journey found between ${origin} and ${destination}.`,
        code: 'JOURNEY_NOT_FOUND',
      },
    });
    return;
  }

  res.json(payload);
});

/**
 * Directions proxy. The map asks this endpoint for a road-snapped path; the key
 * stays on the server. Without a key it answers 503 and the client keeps drawing
 * the stop-to-stop geometry it already has.
 */
mapsRouter.get('/maps/directions', async (req, res) => {
  const origin = parsePoint(req.query.origin ?? req.query.from);
  const destination = parsePoint(req.query.destination ?? req.query.to);

  if (!origin || !destination) {
    res.status(400).json({
      error: {
        message: 'Provide ?origin=lat,lng&destination=lat,lng with valid coordinates',
        code: 'MISSING_PARAMETERS',
      },
    });
    return;
  }

  const mode = String(req.query.mode ?? 'transit');
  if (!['transit', 'driving', 'walking', 'bicycling'].includes(mode)) {
    res.status(400).json({
      error: {
        message: '`mode` must be one of: transit, driving, walking, bicycling',
        code: 'INVALID_PARAMETER',
      },
    });
    return;
  }

  try {
    res.json(await fetchDirections({ origin, destination, mode }));
  } catch (error) {
    if (error instanceof MapsKeyMissingError) {
      res.status(503).json({ error: { message: error.message, code: error.code } });
      return;
    }
    res.status(502).json({
      error: { message: (error as Error).message, code: 'DIRECTIONS_UPSTREAM_ERROR' },
    });
  }
});

function parsePoint(value: unknown): MapPoint | null {
  const raw = String(value ?? '').trim();
  const match = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(raw);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}
