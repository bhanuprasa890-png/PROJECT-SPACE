import type {
  AlertSeverity,
  CrowdLevel,
  DirectionsResult,
  MapAlertMarker,
  MapBounds,
  MapJourneyPayload,
  MapNetworkPayload,
  MapPoint,
  MapRouteGeometry,
  MapStopNode,
  MapVehicleMarker,
  MapsConfigPayload,
  TransitMode,
} from '@shared/types';
import { crowdLevelFromRatio } from '@shared/crowd';
import type { Queryable } from '../db/client';
import { env } from '../config/env';
import { getAgency } from '../repositories/network.repo';
import {
  listMapAlerts,
  listRouteForecasts,
  listRouteStops,
  listRouteStopsForRoutes,
  listVehiclePositions,
  type MapStopRow,
} from '../repositories/map.repo';
import { planJourney } from './planner';

/**
 * TransitPulse AI on top of Google Maps
 * ====================================
 *
 * Google Maps supplies the geography — the roads, places and base canvas, and the
 * Directions service behind `/maps/directions`. This module supplies the
 * intelligence layer drawn on top of it: route geometry assembled from
 * `route_stops`, measured load per stop from `v_line_crowding_now`, the next AI
 * forecast per route from `occupancy_predictions`, and the simulated fleet from
 * `vehicle_snapshots`.
 *
 * Nothing here fabricates a coordinate or a crowd value — every number is a row in
 * Postgres, and every payload carries `simulated: true` plus a disclaimer so no
 * surface can present the demo as real-world telemetry.
 */

export const MAP_DISCLAIMER =
  'Demo network: coordinates, vehicles and crowding come from the TransitPulse ' +
  'simulated dataset, not from a live transport feed.';

function toLevel(value: string | null | undefined): CrowdLevel | null {
  return value === 'low' || value === 'moderate' || value === 'high' ? value : null;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/* -------------------------------------------------------------------------- */
/* Geometry assembly                                                          */
/* -------------------------------------------------------------------------- */

function groupRouteStops(rows: MapStopRow[]): MapRouteGeometry[] {
  const routes = new Map<string, MapRouteGeometry>();

  for (const row of rows) {
    let route = routes.get(row.route_id);
    if (!route) {
      route = {
        routeId: row.route_id,
        routeNumber: row.route_number,
        routeName: row.route_name,
        color: row.color,
        mode: row.mode as TransitMode,
        headwayMinutes: Number(row.headway_minutes ?? 0),
        capacityPerVehicle: Number(row.capacity_per_vehicle ?? 0),
        stops: [],
        path: [],
        predictedPct: null,
        predictedLevel: null,
        confidencePct: null,
        predictionTime: null,
        worstStopName: null,
      };
      routes.set(row.route_id, route);
    }

    const stop: MapStopNode = {
      id: row.stop_id,
      name: row.stop_name,
      sequence: Number(row.stop_order),
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      interchange: Boolean(row.is_interchange),
      dailyBoardings: Number(row.daily_boardings ?? 0),
      liveRatio: row.live_ratio === null ? null : Number(row.live_ratio),
      liveLevel: toLevel(row.live_level),
      onboardCount: row.onboard_count === null ? null : Number(row.onboard_count),
      observedAt: row.observed_at,
    };

    route.stops.push(stop);
    route.path.push([stop.lng, stop.lat]);
  }

  for (const route of routes.values()) {
    route.stops.sort((a, b) => a.sequence - b.sequence);
  }

  return [...routes.values()].sort((a, b) => a.routeNumber.localeCompare(b.routeNumber));
}

function boundsOf(routes: MapRouteGeometry[], vehicles: MapVehicleMarker[]): MapBounds | null {
  const points: MapPoint[] = [
    ...routes.flatMap((route) => route.path),
    ...vehicles.map((vehicle) => [vehicle.lng, vehicle.lat] as MapPoint),
  ];
  if (!points.length) return null;

  const lats = points.map(([, lat]) => lat);
  const lngs = points.map(([lng]) => lng);
  return {
    north: Math.max(...lats),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    west: Math.min(...lngs),
  };
}

/* -------------------------------------------------------------------------- */
/* Network map (rider overview + operator control room)                        */
/* -------------------------------------------------------------------------- */

export async function buildNetworkMap(db: Queryable): Promise<MapNetworkPayload> {
  const [stopRows, forecastRows, vehicleRows, alertRows, agency] = await Promise.all([
    listRouteStops(db),
    listRouteForecasts(db),
    listVehiclePositions(db),
    listMapAlerts(db),
    getAgency(db),
  ]);

  const routes = groupRouteStops(stopRows);
  const forecastByRoute = new Map(forecastRows.map((row) => [row.route_id, row]));

  for (const route of routes) {
    const forecast = forecastByRoute.get(route.routeId);
    if (!forecast) continue;
    route.predictedPct = Number(forecast.predicted_pct);
    route.predictedLevel = toLevel(forecast.predicted_level);
    route.confidencePct = Number(forecast.confidence_pct);
    route.predictionTime = forecast.prediction_time;
    route.worstStopName = forecast.stop_name;
  }

  const vehicles: MapVehicleMarker[] = vehicleRows.map((row) => {
    const capacity = Math.max(Number(row.capacity ?? 0), 1);
    const occupancy = Number(row.current_occupancy ?? 0);
    const ratio = occupancy / capacity;
    return {
      id: row.id,
      vehicleNumber: row.vehicle_number,
      routeId: row.route_id,
      routeNumber: row.route_number,
      routeName: row.route_name,
      color: row.color,
      mode: row.mode as TransitMode,
      capacity,
      occupancy,
      ratio: round(ratio, 4),
      level: crowdLevelFromRatio(ratio),
      status: row.status,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      updatedAt: row.updated_at,
      nextStopName: row.next_stop_name,
      predictedPct: row.predicted_pct === null ? null : Number(row.predicted_pct),
      confidencePct: row.confidence_pct === null ? null : Number(row.confidence_pct),
    };
  });

  const alerts: MapAlertMarker[] = alertRows
    .filter((row) => row.latitude !== null && row.longitude !== null)
    .map((row) => ({
      id: row.id,
      severity: row.severity as AlertSeverity,
      category: row.category,
      title: row.title,
      status: row.status,
      routeId: row.route_id,
      routeNumber: row.route_number,
      color: row.color,
      stopName: row.stop_name,
      lat: Number(row.latitude),
      lng: Number(row.longitude),
      startsAt: row.starts_at,
    }));

  return {
    simulated: true,
    disclaimer: MAP_DISCLAIMER,
    generatedAt: new Date().toISOString(),
    timeZone: agency?.timezone ?? 'Asia/Kolkata',
    city: agency?.city ?? 'Chennai',
    bounds: boundsOf(routes, vehicles),
    routes,
    vehicles,
    alerts,
    totals: {
      routes: routes.length,
      stops: routes.reduce((sum, route) => sum + route.stops.length, 0),
      vehicles: vehicles.length,
      alerts: alerts.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Journey geometry (used by the rider screens)                                */
/* -------------------------------------------------------------------------- */

export interface MapJourneyRequest {
  originStopId: string;
  destinationStopId: string;
  departAfter?: string;
  avoidCrowding?: boolean;
  maxTransfers?: number;
  profileId?: string;
}

export async function buildJourneyMap(
  db: Queryable,
  request: MapJourneyRequest,
): Promise<MapJourneyPayload | null> {
  const plan = await planJourney(db, {
    originStopId: request.originStopId,
    destinationStopId: request.destinationStopId,
    departAfter: request.departAfter,
    avoidCrowding: request.avoidCrowding,
    maxTransfers: request.maxTransfers,
    profileId: request.profileId,
    persist: false,
  });
  if (!plan) return null;

  const lineIds = [
    ...new Set(
      plan.options.flatMap((option) =>
        option.legs
          .filter((leg) => leg.kind === 'transit' && leg.lineId)
          .map((leg) => leg.lineId as string),
      ),
    ),
  ];

  const [stopRows, forecastRows, vehicleRows] = await Promise.all([
    listRouteStopsForRoutes(db, lineIds),
    listRouteForecasts(db),
    listVehiclePositions(db),
  ]);

  const routes = groupRouteStops(stopRows);
  const forecastByRoute = new Map(forecastRows.map((row) => [row.route_id, row]));

  for (const route of routes) {
    const forecast = forecastByRoute.get(route.routeId);
    if (!forecast) continue;
    route.predictedPct = Number(forecast.predicted_pct);
    route.predictedLevel = toLevel(forecast.predicted_level);
    route.confidencePct = Number(forecast.confidence_pct);
    route.predictionTime = forecast.prediction_time;
    route.worstStopName = forecast.stop_name;
  }

  const usedRoutes = new Set(routes.map((route) => route.routeId));
  const vehicles: MapVehicleMarker[] = vehicleRows
    .filter((row) => usedRoutes.has(row.route_id))
    .map((row) => {
      const capacity = Math.max(Number(row.capacity ?? 0), 1);
      const occupancy = Number(row.current_occupancy ?? 0);
      const ratio = occupancy / capacity;
      return {
        id: row.id,
        vehicleNumber: row.vehicle_number,
        routeId: row.route_id,
        routeNumber: row.route_number,
        routeName: row.route_name,
        color: row.color,
        mode: row.mode as TransitMode,
        capacity,
        occupancy,
        ratio: round(ratio, 4),
        level: crowdLevelFromRatio(ratio),
        status: row.status,
        lat: Number(row.latitude),
        lng: Number(row.longitude),
        updatedAt: row.updated_at,
        nextStopName: row.next_stop_name,
        predictedPct: row.predicted_pct === null ? null : Number(row.predicted_pct),
        confidencePct: row.confidence_pct === null ? null : Number(row.confidence_pct),
      };
    });

  return {
    simulated: true,
    disclaimer: MAP_DISCLAIMER,
    generatedAt: new Date().toISOString(),
    originStopId: plan.origin.id,
    destinationStopId: plan.destination.id,
    departAfter: plan.departAfter,
    lineIds,
    routes,
    vehicles,
    bounds: boundsOf(routes, vehicles),
  };
}

/* -------------------------------------------------------------------------- */
/* Directions proxy                                                            */
/* -------------------------------------------------------------------------- */

export class MapsKeyMissingError extends Error {
  readonly code = 'MAPS_KEY_MISSING';
  constructor() {
    super(
      'No Google Maps server key is configured. Set GOOGLE_MAPS_API_KEY to enable '
        + 'road-snapped directions; the map falls back to stop-to-stop geometry.',
    );
    this.name = 'MapsKeyMissingError';
  }
}

/** Decodes Google's encoded polyline into [lng, lat] pairs. */
export function decodePolyline(encoded: string): MapPoint[] {
  const points: MapPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng / 1e5, lat / 1e5]);
  }

  return points;
}

/**
 * Calls the Directions API with the server key. The key never leaves this process,
 * which is the whole point of proxying the call.
 */
export async function fetchDirections(input: {
  origin: MapPoint;
  destination: MapPoint;
  mode: string;
}): Promise<DirectionsResult> {
  if (!env.maps.serverKey) throw new MapsKeyMissingError();

  const params = new URLSearchParams({
    origin: `${input.origin[1]},${input.origin[0]}`,
    destination: `${input.destination[1]},${input.destination[0]}`,
    mode: input.mode,
    key: env.maps.serverKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`, {
    signal: AbortSignal.timeout(6000),
  });
  const body = (await response.json()) as {
    status?: string;
    error_message?: string;
    routes?: {
      summary?: string;
      overview_polyline?: { points?: string };
      legs?: { distance?: { value?: number }; duration?: { value?: number } }[];
    }[];
  };

  if (!response.ok || body.status !== 'OK' || !body.routes?.length) {
    throw new Error(
      body.error_message ?? `Google Directions returned ${body.status ?? response.status}`,
    );
  }

  const route = body.routes[0];
  return {
    source: 'google-directions',
    mode: input.mode,
    path: decodePolyline(route.overview_polyline?.points ?? ''),
    distanceMeters: route.legs?.[0]?.distance?.value ?? null,
    durationSeconds: route.legs?.[0]?.duration?.value ?? null,
    summary: route.summary ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Browser configuration                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The browser only ever receives the referrer-restricted browser key (if one is
 * configured). The server key used for Directions is never exposed.
 */
export function mapsConfig(): MapsConfigPayload {
  const browserKey = env.maps.browserKey;
  return {
    browserKey,
    keySource: browserKey ? 'server-env' : 'none',
    directions: Boolean(env.maps.serverKey && env.maps.directionsEnabled),
    simulated: true,
    hint: browserKey
      ? 'Real Google Maps basemap with the TransitPulse crowd layer on top.'
      : 'No browser key configured: set GOOGLE_MAPS_BROWSER_KEY (referrer restricted) to load Google Maps. The crowd layer still renders on the schematic network.',
  };
}
