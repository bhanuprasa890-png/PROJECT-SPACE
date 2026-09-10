import {
  CROWD_LEVEL_META,
  CROWD_LEVELS,
  crowdLevelFromRatio,
} from '../../shared/crowd';
import type {
  AiAlert,
  AiRecommendation,
  CommandCenter,
  CommandKpis,
  CommandRouteRow,
  CrowdHeatmap,
  CrowdLevel,
  HeatmapSegment,
  HeatmapStop,
  RouteAnalytics,
  RouteAnalyticsPoint,
  RouteOperatingStatus,
  TrendDirection,
} from '../../shared/types';
import type { Queryable } from '../db/client';
import { TARGET_DEFAULTS, getConfig, type ServiceTargets } from '../repositories/config.repo';
import {
  getCommandNetwork,
  getFleetAvailability,
  listCommandLines,
  listCommandLineStops,
  listCommandNotices,
  listLineForecast,
  listLineHistory,
  listNetworkForecast,
  listNetworkHistory,
  type CommandLineRow,
  type CommandStopRow,
} from '../repositories/command.repo';
import { PredictionEngine, SIMULATION_DISCLAIMER } from './prediction';

/**
 * Operator Command Center
 * =======================
 *
 * Assembles the control-room payload from the database and the prediction layer:
 *
 *   Network overview   → `v_line_crowding_now` + `vehicles` + `lines`
 *   Live route status  → live load per route + fleet + service pattern + notices
 *   Crowd heatmap      → route geometry (`line_stops` + `stops` lat/lng) coloured
 *                        by measured *and* predicted crowding
 *   AI alerts          → engine predictions at +15/+30/+45/+60 min on the
 *                        busiest stop of each route, triaged by severity
 *   AI recommendations → rule-based plays over those predictions (extra
 *                        vehicle, passenger redirect, headway rebalance)
 *   Route analytics    → hourly `crowd_observations` history + persisted
 *                        `crowd_forecasts` ahead of now
 *
 * Every value is computed from rows in Postgres; the thresholds come from
 * `model_config.service_targets` so operations can retune them without a deploy.
 *
 * DEMO / SIMULATED DATA: the underlying telemetry, weather and fleet snapshots
 * are synthetic. Nothing here describes a real network and no production
 * accuracy is claimed — the payload carries `simulated: true` and a disclaimer.
 */

const HORIZONS = [15, 30, 45, 60] as const;
/** Watch list floor: routes between 70% and the crowding threshold. */
const WATCH_RATIO = 0.7;
const MAX_ALERTS = 9;
const MAX_RECOMMENDATIONS = 5;

interface LinePrediction {
  horizonMinutes: number;
  ratio: number;
  percentage: number;
  headcount: number;
  confidence: number;
  level: CrowdLevel;
  at: string;
  stopId: string | null;
  stopName: string | null;
}

interface LineComputation {
  row: CommandLineRow;
  liveRatio: number;
  livePct: number;
  predictions: LinePrediction[];
  /** Highest predicted ratio across the horizon set. */
  peak: LinePrediction | null;
  at30: LinePrediction | null;
  shareStops: string[];
}

function pct(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function trendFor(current: number, predicted: number): { trend: TrendDirection; deltaPct: number } {
  const deltaPct = round(pct(predicted) - pct(current), 1);
  if (deltaPct >= 6) return { trend: 'rising', deltaPct };
  if (deltaPct <= -6) return { trend: 'falling', deltaPct };
  return { trend: 'stable', deltaPct };
}

const STATUS_LABELS: Record<RouteOperatingStatus, string> = {
  on_time: 'On time',
  boarding: 'Boarding',
  crowded: 'Crowded',
  delayed: 'Delayed',
  disrupted: 'Disrupted',
};

/**
 * Operating status for a route: disruptions beat crowding, crowding beats a
 * delay, and a service about to depart is called out as boarding.
 */
function statusFor(
  line: CommandLineRow,
  peakPct: number,
  crowdingThresholdPct: number,
  minutesToDeparture: number | null,
  hasCriticalNotice: boolean,
): { status: RouteOperatingStatus; statusLabel: string; statusDetail: string } {
  const onTimePct = Number(line.adherence_pct ?? 100);

  if (hasCriticalNotice) {
    return {
      status: 'disrupted',
      statusLabel: STATUS_LABELS.disrupted,
      statusDetail: 'Critical service notice active on this route',
    };
  }
  if (peakPct >= crowdingThresholdPct) {
    return {
      status: 'crowded',
      statusLabel: STATUS_LABELS.crowded,
      statusDetail: `Peak load forecast at ${peakPct.toFixed(0)}% of capacity`,
    };
  }
  if (line.major_alerts > 0 || onTimePct < 90) {
    return {
      status: 'delayed',
      statusLabel: STATUS_LABELS.delayed,
      statusDetail:
        line.major_alerts > 0
          ? `${line.major_alerts} major notice(s) · adherence ${onTimePct.toFixed(0)}%`
          : `Adherence ${onTimePct.toFixed(0)}% below the 90% floor`,
    };
  }
  if (minutesToDeparture !== null && minutesToDeparture <= 5) {
    return {
      status: 'boarding',
      statusLabel: STATUS_LABELS.boarding,
      statusDetail: `Next departure in ${Math.max(0, Math.round(minutesToDeparture))} min`,
    };
  }
  return {
    status: 'on_time',
    statusLabel: STATUS_LABELS.on_time,
    statusDetail: `${line.vehicles_in_service} vehicle(s) in service · adherence ${onTimePct.toFixed(0)}%`,
  };
}

function buildHeatmap(rows: CommandStopRow[]): CrowdHeatmap {
  const byLine = new Map<string, CommandStopRow[]>();
  for (const row of rows) {
    const list = byLine.get(row.line_id);
    if (list) list.push(row);
    else byLine.set(row.line_id, [row]);
  }

  const stopAggregate = new Map<string, HeatmapStop>();
  const segments: HeatmapSegment[] = [];

  for (const [lineId, list] of byLine) {
    const ordered = [...list].sort((a, b) => a.seq - b.seq);

    const resolve = (
      row: CommandStopRow,
    ): { ratio: number; predictedRatio: number; peakRatio: number } => {
      const live = row.live_ratio === null ? null : Number(row.live_ratio);
      const forecast = row.forecast_ratio === null ? null : Number(row.forecast_ratio);
      const peak = row.peak_ratio === null ? null : Number(row.peak_ratio);
      return {
        ratio: Number(live ?? forecast ?? 0),
        predictedRatio: Number(forecast ?? live ?? 0),
        peakRatio: Number(peak ?? live ?? forecast ?? 0),
      };
    };

    for (let index = 0; index < ordered.length; index += 1) {
      const row = ordered[index];
      const { ratio, predictedRatio, peakRatio } = resolve(row);
      const existing = stopAggregate.get(row.stop_id);

      if (existing) {
        existing.ratio = Math.max(existing.ratio, ratio);
        existing.predictedRatio = Math.max(existing.predictedRatio, predictedRatio);
        existing.peakRatio = Math.max(existing.peakRatio, peakRatio);
        existing.level = crowdLevelFromRatio(existing.ratio);
        existing.predictedLevel = crowdLevelFromRatio(existing.predictedRatio);
        existing.peakLevel = crowdLevelFromRatio(existing.peakRatio);
        if (!existing.routes.includes(row.code)) existing.routes.push(row.code);
      } else {
        stopAggregate.set(row.stop_id, {
          stopId: row.stop_id,
          code: row.stop_code,
          name: row.stop_name,
          latitude: Number(row.lat),
          longitude: Number(row.lng),
          interchange: Boolean(row.is_interchange),
          boardings: Number(row.daily_boardings),
          ratio,
          level: crowdLevelFromRatio(ratio),
          predictedRatio,
          predictedLevel: crowdLevelFromRatio(predictedRatio),
          peakRatio,
          peakLevel: crowdLevelFromRatio(peakRatio),
          routes: [row.code],
        });
      }

      const next = ordered[index + 1];
      if (!next) continue;
      const nextLoad = resolve(next);
      // A segment carries the busiest of its two endpoints — that is what a
      // controller needs to see when deciding where to add capacity.
      const segmentRatio = Math.max(ratio, nextLoad.ratio);
      const segmentPredicted = Math.max(predictedRatio, nextLoad.predictedRatio);
      const segmentPeak = Math.max(peakRatio, nextLoad.peakRatio);
      segments.push({
        lineId,
        routeNumber: row.code,
        color: row.color,
        mode: row.mode,
        fromStopId: row.stop_id,
        fromName: row.stop_name,
        toStopId: next.stop_id,
        toName: next.stop_name,
        fromLat: Number(row.lat),
        fromLng: Number(row.lng),
        toLat: Number(next.lat),
        toLng: Number(next.lng),
        ratio: round(segmentRatio, 3),
        level: crowdLevelFromRatio(segmentRatio),
        predictedRatio: round(segmentPredicted, 3),
        predictedLevel: crowdLevelFromRatio(segmentPredicted),
        peakRatio: round(segmentPeak, 3),
        peakLevel: crowdLevelFromRatio(segmentPeak),
      });
    }
  }

  const stops = [...stopAggregate.values()];
  const latitudes = stops.map((stop) => stop.latitude);
  const longitudes = stops.map((stop) => stop.longitude);

  return {
    bounds: {
      minLat: latitudes.length ? Math.min(...latitudes) : 0,
      maxLat: latitudes.length ? Math.max(...latitudes) : 1,
      minLng: longitudes.length ? Math.min(...longitudes) : 0,
      maxLng: longitudes.length ? Math.max(...longitudes) : 1,
    },
    stops,
    segments,
    legend: CROWD_LEVELS.map((level) => ({
      level,
      label: CROWD_LEVEL_META[level].label,
      range: CROWD_LEVEL_META[level].range,
    })),
  };
}

/** Stops shared by two routes confirm they are genuine alternatives. */
function parallelRoutes(current: LineComputation, others: LineComputation[], minimumShared = 2) {
  const currentStops = new Set(current.shareStops);
  return others
    .filter((other) => other.row.line_id !== current.row.line_id)
    .map((other) => ({
      other,
      shared: other.shareStops.filter((stopId) => currentStops.has(stopId)),
    }))
    .filter((candidate) => candidate.shared.length >= minimumShared)
    .sort((a, b) => a.other.liveRatio - b.other.liveRatio);
}

function buildAlerts(
  computed: LineComputation[],
  notices: Awaited<ReturnType<typeof listCommandNotices>>,
  crowdingThresholdPct: number,
): AiAlert[] {
  const alerts: AiAlert[] = [];

  for (const line of computed) {
    const peak = line.peak;
    if (!peak) continue;
    if (peak.percentage < WATCH_RATIO * 100) continue;

    const above = peak.percentage >= crowdingThresholdPct;
    const severity: AiAlert['severity'] =
      peak.percentage >= 100 ? 'critical' : peak.percentage >= 90 ? 'major' : above ? 'minor' : 'info';

    const alternatives = parallelRoutes(line, computed);
    const quieter = alternatives.find((candidate) => candidate.other.liveRatio < 0.7);

    const action = above
      ? quieter
        ? `Deploy an additional vehicle on ${line.row.code} and redirect passengers toward Route ${quieter.other.row.code}`
        : `Deploy an additional vehicle on ${line.row.code} and hold the following service at ${peak.stopName ?? 'the next station'}`
      : `Monitor ${line.row.code}; pre-position a standby vehicle for the next departure`;

    const message = `Route ${line.row.code} predicted to reach ${peak.percentage.toFixed(0)}% occupancy in ${peak.horizonMinutes} minutes${
      peak.stopName ? ` at ${peak.stopName}` : ''
    }`;

    alerts.push({
      id: `AIC-${line.row.line_id}-${peak.horizonMinutes}`,
      kind: above ? 'crowding' : 'spread',
      severity,
      lineId: line.row.line_id,
      routeNumber: line.row.code,
      routeName: line.row.name,
      color: line.row.color,
      stopName: peak.stopName,
      message,
      predictedOccupancyPct: round(peak.percentage, 1),
      inMinutes: peak.horizonMinutes,
      estimatedAt: peak.at,
      confidencePct: round(peak.confidence * 100, 1),
      thresholdPct: crowdingThresholdPct,
      recommendedAction: action,
      state: above ? 'open' : 'watch',
    });
  }

  for (const notice of notices) {
    const line = computed.find((item) => item.row.line_id === notice.line_id);
    const live = line ? round(line.livePct, 1) : 0;
    alerts.push({
      id: `OPS-${notice.id}`,
      kind: 'disruption',
      severity: notice.severity,
      lineId: notice.line_id,
      routeNumber: notice.line_code ?? 'Network',
      routeName: notice.line_name ?? 'Network-wide',
      color: notice.line_color ?? '#38bdf8',
      stopName: null,
      message: notice.title,
      predictedOccupancyPct: line?.peak ? round(line.peak.percentage, 1) : live,
      inMinutes: 0,
      estimatedAt: new Date(notice.starts_at).toISOString(),
      confidencePct: line?.at30 ? round(line.at30.confidence * 100, 1) : 0,
      thresholdPct: crowdingThresholdPct,
      recommendedAction:
        notice.category === 'weather'
          ? 'Confirm replacement capacity and publish a rider advisory'
          : 'Acknowledge, publish a rider advisory and keep the recovery plan updated',
      state: 'open',
    });
  }

  const rank: Record<AiAlert['severity'], number> = { critical: 0, major: 1, minor: 2, info: 3 };
  return alerts
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.inMinutes - b.inMinutes)
    .slice(0, MAX_ALERTS);
}

function buildRecommendations(
  computed: LineComputation[],
  fleet: { idle: number; maintenance: number; inService: number },
  crowdingThresholdPct: number,
  stopNameById: Map<string, string>,
): AiRecommendation[] {
  const recommendations: AiRecommendation[] = [];

  const ranked = [...computed]
    .filter((line) => line.peak && line.peak.percentage >= crowdingThresholdPct - 8)
    .sort((a, b) => (b.peak?.percentage ?? 0) - (a.peak?.percentage ?? 0))
    .slice(0, 4);

  for (const line of ranked) {
    const peak = line.peak;
    if (!peak) continue;

    const inService = Math.max(line.row.vehicles_in_service, 1);
    const extraVehicles = Math.min(
      Math.max(Math.ceil(peak.ratio / (crowdingThresholdPct / 100)) - inService, 1),
      3,
    );
    const relieved = peak.ratio * (inService / (inService + extraVehicles));
    const urgency: AiRecommendation['urgency'] =
      peak.horizonMinutes <= 15 ? 'now' : peak.horizonMinutes <= 45 ? 'next_30' : 'monitor';

    recommendations.push({
      id: `REC-VEH-${line.row.line_id}`,
      kind: 'add_vehicle',
      urgency,
      lineId: line.row.line_id,
      routeNumber: line.row.code,
      routeName: line.row.name,
      color: line.row.color,
      targetRouteNumber: null,
      title: `Deploy ${extraVehicles} additional vehicle${extraVehicles > 1 ? 's' : ''} to Route ${line.row.code}`,
      detail: `Peak load is forecast at ${peak.percentage.toFixed(0)}%${
        peak.stopName ? ` at ${peak.stopName}` : ''
      } in ${peak.horizonMinutes} minutes. ${inService} of ${line.row.vehicles_total} vehicles are in service on ${
        line.row.headway_minutes
      }-minute headways.`,
      impactLabel: `≈ ${pct(peak.ratio).toFixed(0)}% → ${pct(relieved).toFixed(0)}% peak load on the busiest service`,
      confidencePct: round(peak.confidence * 100, 1),
      evidence: [
        { label: 'Forecast occupancy', value: `${peak.percentage.toFixed(0)}%` },
        { label: 'Horizon', value: `${peak.horizonMinutes} min` },
        { label: 'Vehicles in service', value: `${inService} / ${line.row.vehicles_total}` },
        { label: 'Headway', value: `${line.row.headway_minutes} min` },
      ],
    });

    const alternatives = parallelRoutes(line, computed);
    const quieter = alternatives.find((candidate) => candidate.other.liveRatio < 0.6);
    if (quieter) {
      const sharedStop = quieter.shared[0];
      const stopName =
        stopNameById.get(sharedStop) ?? quieter.other.row.worst_stop_name ?? 'the shared interchange';
      const spareSeats = Math.max(
        0,
        Math.round(
          (1 - quieter.other.liveRatio) * quieter.other.row.capacity_per_vehicle * quieter.other.row.vehicles_in_service,
        ),
      );
      recommendations.push({
        id: `REC-RED-${line.row.line_id}-${quieter.other.row.line_id}`,
        kind: 'redirect_passengers',
        urgency,
        lineId: line.row.line_id,
        routeNumber: line.row.code,
        routeName: line.row.name,
        color: line.row.color,
        targetRouteNumber: quieter.other.row.code,
        title: `Redirect passengers toward Route ${quieter.other.row.code}`,
        detail: `Routes ${line.row.code} and ${quieter.other.row.code} share ${quieter.shared.length} stops including ${stopName}. Route ${
          quieter.other.row.code
        } is running at ${quieter.other.livePct.toFixed(0)}% with ${spareSeats} free seats per service.`,
        impactLabel: `Offloads ≈ ${Math.round(Math.min(0.35, spareSeats / Math.max(Number(line.row.headcount ?? 0), 1)) * 100)}% of the peak load onto a quieter corridor`,
        confidencePct: round((peak.confidence + (quieter.other.at30?.confidence ?? 0.9)) / 2 * 100, 1),
        evidence: [
          { label: 'Shared stops', value: `${quieter.shared.length}` },
          { label: 'Target route load', value: `${quieter.other.livePct.toFixed(0)}%` },
          { label: 'Spare seats', value: `${spareSeats} per service` },
        ],
      });
    }

    if (extraVehicles > fleet.idle && line.row.vehicles_in_service >= 2) {
      const tightened = Math.max(3, line.row.headway_minutes - 1);
      recommendations.push({
        id: `REC-HDW-${line.row.line_id}`,
        kind: 'rebalance_headway',
        urgency,
        lineId: line.row.line_id,
        routeNumber: line.row.code,
        routeName: line.row.name,
        color: line.row.color,
        targetRouteNumber: null,
        title: `Tighten ${line.row.code} headway from ${line.row.headway_minutes} → ${tightened} min`,
        detail: `Only ${fleet.idle} spare vehicle(s) are available network-wide, so the short-term relief is frequency: a ${tightened}-minute headway spreads the same demand over more services.`,
        impactLabel: `≈ ${Math.round(((line.row.headway_minutes - tightened) / line.row.headway_minutes) * 100)}% more capacity per hour on this route`,
        confidencePct: round((line.at30?.confidence ?? 0.9) * 100, 1),
        evidence: [
          { label: 'Spare vehicles', value: `${fleet.idle}` },
          { label: 'Current headway', value: `${line.row.headway_minutes} min` },
          { label: 'Recommended', value: `${tightened} min` },
        ],
      });
    }
  }

  // --- readiness plays -------------------------------------------------------
  // A control room always needs a next action, even when the network is calm:
  // pre-position capacity ahead of a route's known peak, and get the fleet out
  // of the workshop before demand builds.
  const byPeak = [...computed].sort(
    (a, b) => Number(b.row.peak_24h_ratio ?? 0) - Number(a.row.peak_24h_ratio ?? 0),
  );

  const headlineRoute = byPeak[0];
  if (recommendations.length < 2 && headlineRoute) {
    const peakRatio = Number(headlineRoute.row.peak_24h_ratio ?? headlineRoute.liveRatio);
    const peakHour = headlineRoute.row.peak_hour;
    const forecast = headlineRoute.at30 ?? headlineRoute.peak;
    recommendations.push({
      id: `REC-POS-${headlineRoute.row.line_id}`,
      kind: 'add_vehicle',
      urgency: 'monitor',
      lineId: headlineRoute.row.line_id,
      routeNumber: headlineRoute.row.code,
      routeName: headlineRoute.row.name,
      color: headlineRoute.row.color,
      targetRouteNumber: null,
      title: `Pre-position a standby vehicle for Route ${headlineRoute.row.code}`,
      detail: `Route ${headlineRoute.row.code} peaked at ${pct(peakRatio).toFixed(0)}% over the last 24 hours${
        peakHour === null ? '' : ` around ${String(peakHour).padStart(2, '0')}:00`
      }; ${headlineRoute.row.vehicles_in_service} vehicle(s) are in service and the next hour is forecast at ${
        forecast ? forecast.percentage.toFixed(0) : pct(headlineRoute.liveRatio).toFixed(0)
      }%.`,
      impactLabel: 'Removes the dispatch delay when the peak builds',
      confidencePct: forecast ? round(forecast.confidence * 100, 1) : 90,
      evidence: [
        { label: '24-hour peak', value: `${pct(peakRatio).toFixed(0)}%` },
        { label: 'Typical peak hour', value: peakHour === null ? 'n/a' : `${String(peakHour).padStart(2, '0')}:00` },
        { label: 'Vehicles in service', value: `${headlineRoute.row.vehicles_in_service} / ${headlineRoute.row.vehicles_total}` },
      ],
    });
  }

  if (fleet.maintenance > 0) {
    const busiest = byPeak[0];
    const toReturn = Math.min(2, fleet.maintenance);
    recommendations.push({
      id: 'REC-FLEET-READINESS',
      kind: 'fleet_readiness',
      urgency: 'monitor',
      lineId: busiest?.row.line_id ?? '',
      routeNumber: busiest?.row.code ?? 'Network',
      routeName: busiest?.row.name ?? 'Network',
      color: busiest?.row.color ?? '#38bdf8',
      targetRouteNumber: null,
      title: `Return ${toReturn} of ${fleet.maintenance} maintenance vehicles to service before the next peak`,
      detail: `${fleet.idle} vehicle(s) are idle and ${fleet.inService} are in service across the network. Clearing the workshop ahead of ${
        busiest?.row.peak_hour === null || busiest?.row.peak_hour === undefined
          ? 'the next peak'
          : `${String(busiest.row.peak_hour).padStart(2, '0')}:00`
      } keeps the spare ratio above 1 vehicle per route.`,
      impactLabel: `+${toReturn} vehicle(s) available for dispatch`,
      confidencePct: 100,
      evidence: [
        { label: 'In maintenance', value: `${fleet.maintenance}` },
        { label: 'Idle', value: `${fleet.idle}` },
        { label: 'In service', value: `${fleet.inService}` },
      ],
    });
  }

  const rank: Record<AiRecommendation['urgency'], number> = { now: 0, next_30: 1, monitor: 2 };
  return recommendations
    .sort((a, b) => rank[a.urgency] - rank[b.urgency])
    .slice(0, MAX_RECOMMENDATIONS);
}

export async function buildCommandCenter(
  db: Queryable,
  options: { historyHours?: number; forecastHours?: number } = {},
): Promise<CommandCenter> {
  const historyHours = options.historyHours ?? 24;
  const forecastHours = options.forecastHours ?? 6;

  const [network, lineRows, stopRows, notices, fleet, targets, netHistory, netForecast, lineHistory, lineForecast] =
    await Promise.all([
      getCommandNetwork(db),
      listCommandLines(db),
      listCommandLineStops(db),
      listCommandNotices(db, 8),
      getFleetAvailability(db),
      getConfig<ServiceTargets>(db, 'service_targets', TARGET_DEFAULTS),
      listNetworkHistory(db, historyHours),
      listNetworkForecast(db, forecastHours),
      listLineHistory(db, historyHours),
      listLineForecast(db, 4),
    ]);

  const engine = await PredictionEngine.load(db);

  const stopNameById = new Map<string, string>();
  for (const row of stopRows) stopNameById.set(row.stop_id, row.stop_name);

  const crowdingThresholdPct = round(targets.crowdingThresholdRatio * 100, 1);
  const now = Date.now();

  // --- predictions per route (busiest monitored stop, four horizons) --------
  const computed: LineComputation[] = [];
  for (const row of lineRows) {
    const lineStops = stopRows.filter((stop) => stop.line_id === row.line_id);
    const worstStopId =
      row.worst_stop_id ?? lineStops.sort((a, b) => a.seq - b.seq)[0]?.stop_id ?? null;

    const liveRatio = Number(row.max_ratio ?? row.avg_ratio ?? 0);
    const predictions: LinePrediction[] = [];

    for (const horizon of HORIZONS) {
      const at = new Date(now + horizon * 60_000);
      const result = await engine.predict({
        lineIdOrCode: row.line_id,
        stopId: worstStopId,
        at,
        capacity: Number(row.capacity_per_vehicle),
        weather: 'auto',
      });
      if (!result) continue;
      predictions.push({
        horizonMinutes: horizon,
        ratio: result.predictedRatio,
        percentage: result.predictedOccupancyPercentage,
        headcount: result.headcount,
        confidence: result.confidencePercentage / 100,
        level: result.crowd.level,
        at: result.targetAt,
        stopId: result.stop?.id ?? worstStopId,
        stopName: result.stop?.name ?? (worstStopId ? stopNameById.get(worstStopId) ?? null : null),
      });
    }

    computed.push({
      row,
      liveRatio,
      livePct: pct(liveRatio),
      predictions,
      peak: predictions.reduce<LinePrediction | null>(
        (best, item) => (!best || item.percentage > best.percentage ? item : best),
        null,
      ),
      at30: predictions.find((item) => item.horizonMinutes === 30) ?? predictions[0] ?? null,
      shareStops: lineStops.map((stop) => stop.stop_id),
    });
  }

  // --- live route status ----------------------------------------------------
  const routes: CommandRouteRow[] = computed.map((line) => {
    const predicted = line.at30;
    const predictedPct = predicted ? round(predicted.percentage, 1) : line.livePct;
    const { trend, deltaPct } = trendFor(line.liveRatio, predicted?.ratio ?? line.liveRatio);
    const minutesToDeparture = line.row.next_departure_at
      ? (new Date(line.row.next_departure_at).getTime() - now) / 60_000
      : null;
    const hasCriticalNotice = notices.some(
      (notice) => notice.line_id === line.row.line_id && notice.severity === 'critical',
    );
    const status = statusFor(
      line.row,
      line.peak ? line.peak.percentage : line.livePct,
      crowdingThresholdPct,
      minutesToDeparture,
      hasCriticalNotice,
    );

    return {
      lineId: line.row.line_id,
      routeNumber: line.row.code,
      routeName: line.row.name,
      color: line.row.color,
      mode: line.row.mode,
      occupancyPct: round(line.livePct, 1),
      predictedPct,
      peak24hPct: round(Number(line.row.peak_24h_ratio ?? line.row.max_ratio ?? 0) * 100, 1),
      level: crowdLevelFromRatio(line.liveRatio),
      predictedLevel: crowdLevelFromRatio(predicted?.ratio ?? line.liveRatio),
      trend,
      trendDeltaPct: deltaPct,
      vehiclesTotal: Number(line.row.vehicles_total),
      vehiclesInService: Number(line.row.vehicles_in_service),
      capacityPerVehicle: Number(line.row.capacity_per_vehicle),
      headcount: Number(line.row.headcount ?? 0),
      capacity: Number(line.row.capacity ?? 0),
      onTimePct: round(Number(line.row.adherence_pct ?? 100), 1),
      headwayMinutes: Number(line.row.headway_minutes),
      nextDepartureAt: line.row.next_departure_at
        ? new Date(line.row.next_departure_at).toISOString()
        : null,
      serviceFirst: line.row.first_departure,
      serviceLast: line.row.last_departure,
      peakHour: line.row.peak_hour === null ? null : Number(line.row.peak_hour),
      worstStopName: line.row.worst_stop_name,
      stopsMonitored: Number(line.row.stops_monitored),
      status: status.status,
      statusLabel: status.statusLabel,
      statusDetail: status.statusDetail,
      activeAlerts: Number(line.row.active_alerts),
      majorAlerts: Number(line.row.major_alerts),
      alertsLastHour: notices.filter(
        (notice) =>
          notice.line_id === line.row.line_id && now - new Date(notice.starts_at).getTime() < 3_600_000,
      ).length,
    };
  });

  // --- analytics ------------------------------------------------------------
  const toPoints = (
    rows: { bucket: string | Date; ratio: number | string }[],
    kind: RouteAnalyticsPoint['kind'],
  ): RouteAnalyticsPoint[] =>
    rows.map((row) => ({
      at: new Date(row.bucket).toISOString(),
      ratio: round(Number(row.ratio), 3),
      kind,
    }));

  const networkSeries: RouteAnalyticsPoint[] = [
    ...toPoints(netHistory, 'history'),
    ...toPoints(netForecast, 'forecast'),
  ];

  const analytics: RouteAnalytics[] = computed.map((line) => {
    const history = toPoints(
      lineHistory.filter((row) => row.line_id === line.row.line_id),
      'history',
    );
    const forecast = toPoints(
      lineForecast.filter((row) => row.line_id === line.row.line_id),
      'forecast',
    );
    const series = [...history, ...forecast];
    const peak = series.reduce<RouteAnalyticsPoint | null>(
      (best, point) => (!best || point.ratio > best.ratio ? point : best),
      null,
    );
    const predicted = line.at30;
    const predictedPct = predicted ? round(predicted.percentage, 1) : line.livePct;

    return {
      lineId: line.row.line_id,
      routeNumber: line.row.code,
      routeName: line.row.name,
      color: line.row.color,
      mode: line.row.mode,
      currentPct: round(line.livePct, 1),
      predictedPct,
      deltaPct: round(predictedPct - line.livePct, 1),
      trend: trendFor(line.liveRatio, predicted?.ratio ?? line.liveRatio).trend,
      peakPct: peak ? round(peak.ratio * 100, 1) : round(line.livePct, 1),
      peakLabel: peak
        ? `peak at ${new Date(peak.at).toISOString().slice(11, 16)} UTC`
        : 'no readings in window',
      series,
    };
  });

  const highCrowdRoutes = routes.filter((route) => route.occupancyPct >= crowdingThresholdPct).length;
  const watchRoutes = routes.filter(
    (route) => route.occupancyPct < crowdingThresholdPct && route.occupancyPct >= WATCH_RATIO * 100,
  ).length;
  const predictedNetworkPct =
    routes.length > 0
      ? round(routes.reduce((sum, route) => sum + route.predictedPct, 0) / routes.length, 1)
      : 0;

  const disruptedRoutes = routes.filter((route) => route.status === 'disrupted').length;
  const status: CommandKpis['status'] =
    disruptedRoutes > 0 || network.critical_alerts > 0 || highCrowdRoutes > 1
      ? 'critical'
      : highCrowdRoutes > 0 || watchRoutes > 0 || network.active_alerts > 0
        ? 'elevated'
        : 'nominal';

  const statusDetail =
    status === 'critical'
      ? `${disruptedRoutes} route(s) disrupted · ${network.critical_alerts} major notice(s) · ${highCrowdRoutes} above ${crowdingThresholdPct}%`
      : status === 'elevated'
        ? `${highCrowdRoutes} above ${crowdingThresholdPct}% · ${watchRoutes} on watch · ${network.active_alerts} open notice(s)`
        : `All ${routes.length} routes within the ${crowdingThresholdPct}% crowding threshold`;

  return {
    generatedAt: new Date().toISOString(),
    timeZone: 'Asia/Kolkata',
    simulated: true,
    disclaimer: SIMULATION_DISCLAIMER,
    engine: engine.descriptor,
    kpis: {
      activeRoutes: Number(network.active_routes),
      totalRoutes: Number(network.total_routes),
      activeVehicles: Number(network.active_vehicles),
      totalVehicles: Number(network.total_vehicles),
      maintenanceVehicles: Number(network.maintenance_vehicles),
      idleVehicles: Number(network.idle_vehicles),
      highCrowdRoutes,
      watchRoutes,
      averageOccupancyPct: round(Number(network.avg_ratio ?? 0) * 100, 1),
      predictedOccupancyPct: predictedNetworkPct,
      passengersOnboard: Number(network.passengers_onboard ?? 0),
      networkCapacity: Number(network.network_capacity ?? 0),
      status,
      statusDetail,
    },
    routes,
    heatmap: buildHeatmap(stopRows),
    alerts: buildAlerts(computed, notices, crowdingThresholdPct),
    recommendations: buildRecommendations(computed, fleet, crowdingThresholdPct, stopNameById),
    analytics: { network: networkSeries, routes: analytics },
    crowdingThresholdPct,
    refreshSeconds: 60,
  };
}
