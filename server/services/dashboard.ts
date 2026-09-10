import type {
  Alert,
  CommuterDashboard,
  CrowdHotspot,
  DashboardStat,
  PlannerResponse,
  RiderProfile,
  StationBoard,
  UpcomingDeparture,
  WatchlistItem,
} from '../../shared/types';
import type { Queryable } from '../db/client';
import { listAlerts } from '../repositories/alerts.repo';
import { listHotspots } from '../repositories/crowd.repo';
import { getNetworkCounts } from '../repositories/operator.repo';
import { getDefaultProfileId, listWatchlist, getProfile } from '../repositories/riders.repo';
import { listDepartures, getStop, listStops } from '../repositories/network.repo';
import { MODEL_DEFAULTS, getConfig, type CrowdModelConfig } from '../repositories/config.repo';
import { CrowdModel } from './crowd-model';
import { planJourney } from './planner';
import { env } from '../config/env';
import { formatClock, minutesBetween } from '../lib/time';

/**
 * Commuter dashboard service — composes the rider's landing view from the
 * database: their saved journeys, a live recommendation for the next one,
 * departure boards for the stops they care about, and the network's current
 * crowding hotspots.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export async function buildCommuterDashboard(
  db: Queryable,
  requestedProfileId?: string,
): Promise<CommuterDashboard> {
  const profileId =
    requestedProfileId ??
    (await getDefaultProfileId(db, env.defaultProfileId)) ??
    env.defaultProfileId;

  const profile: RiderProfile =
    (await getProfile(db, profileId)) ?? (await fallbackProfile(db, profileId));

  const [watchlistRaw, crowdingNow, alerts, networkTotals, modelConfig, model] = await Promise.all([
    listWatchlist(db, profile.id),
    listHotspots(db, 6),
    listAlerts(db, { limit: 6 }),
    getNetworkCounts(db),
    getConfig<CrowdModelConfig>(db, 'crowd_model', MODEL_DEFAULTS),
    CrowdModel.load(db),
  ]);

  const today = DAY_KEYS[new Date().getUTCDay()];
  const scheduled = watchlistRaw.filter((item) => item.days.includes(today));
  const candidates = scheduled.length ? scheduled : watchlistRaw;
  const upcoming = pickUpcoming(candidates);

  const stationBoards = (
    await Promise.all(
      [profile.homeStopId, profile.workStopId]
        .filter((stopId): stopId is string => Boolean(stopId))
        .slice(0, 2)
        .map((stopId) => buildStationBoard(db, stopId, model)),
    )
  ).filter((board): board is StationBoard => board !== null);

  let nextJourney: CommuterDashboard['nextJourney'] = null;
  if (upcoming) {
    const planned = await planJourney(db, {
      originStopId: upcoming.originStopId,
      destinationStopId: upcoming.destinationStopId,
      departAfter: nextDepartureIso(upcoming.departTime),
      profileId: profile.id,
      avoidCrowding: upcoming.avoidCrowded,
      persist: false,
    });

    if (planned && planned.options.length) {
      nextJourney = {
        watchlistItemId: upcoming.id,
        label: upcoming.label,
        origin: planned.origin,
        destination: planned.destination,
        planned,
      };
    }
  }

  const watchlist: WatchlistItem[] = await Promise.all(
    watchlistRaw.map(async (item) => {
      const snapshot = await snapshotForItem(db, item, model);
      return { ...item, prediction: snapshot };
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    profile,
    stats: buildStats({ nextJourney, crowdingNow, alerts, networkTotals, watchlist }),
    nextJourney,
    watchlist,
    crowdingNow,
    activeAlerts: alerts.filter((alert) => alert.status === 'active').slice(0, 4),
    networkTotals: {
      stopCount: Number(networkTotals.stop_count ?? 0),
      lineCount: Number(networkTotals.line_count ?? 0),
      interchangeCount: Number(networkTotals.interchange_count ?? 0),
      vehiclesInService: Number(networkTotals.vehicles_in_service ?? 0),
      activeAlerts: Number(networkTotals.active_alerts ?? 0),
    },
    stationBoards,
    model: {
      version: modelConfig.version,
      accuracy: modelConfig.accuracy,
      horizonMinutes: modelConfig.horizonMinutes,
    },
  };
}

function pickUpcoming(items: WatchlistItem[]): WatchlistItem | undefined {
  if (!items.length) return undefined;
  const nowMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  return (
    [...items].sort((a, b) => {
      const aMinutes = a.departTime ? toMinutes(a.departTime) : nowMinutes;
      const bMinutes = b.departTime ? toMinutes(b.departTime) : nowMinutes;
      return Math.abs(aMinutes - nowMinutes) - Math.abs(bMinutes - nowMinutes);
    })[0] ?? items[0]
  );
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Departure time for today at the saved clock time, or "now" when unset. */
function nextDepartureIso(departTime: string | null): string {
  const now = new Date();
  if (!departTime) return now.toISOString();
  const target = new Date(now);
  const [hours, minutes] = departTime.split(':').map(Number);
  target.setUTCHours(hours ?? now.getUTCHours(), minutes ?? now.getUTCMinutes(), 0, 0);
  if (target.getTime() < now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.toISOString();
}

async function snapshotForItem(
  db: Queryable,
  item: WatchlistItem,
  model: CrowdModel,
): Promise<WatchlistItem['prediction']> {
  const departIso = nextDepartureIso(item.departTime);
  const departAt = new Date(departIso);
  const departures = await listDepartures(db, item.originStopId, departIso, 45);
  const next = departures[0];
  if (!next) return undefined;

  const prediction = model.predict({
    lineId: next.lineId,
    stopId: item.originStopId,
    at: new Date(next.departureAt),
    capacity: next.vehicleCapacity || 90,
    mode: next.mode,
    headwayMinutes: next.headwayMinutes,
  });

  return {
    ratio: prediction.ratio,
    level: prediction.level,
    confidence: prediction.confidence,
    departAt: next.departureAt,
    lineCode: next.lineCode,
    lineColor: next.lineColor,
    status:
      minutesBetween(new Date(), departAt) > 45
        ? `${formatClock(next.departureAt)} · ${Math.max(
            0,
            minutesBetween(new Date(), departAt),
          )} min to go`
        : `Departs ${formatClock(next.departureAt)}`,
  };
}

async function buildStationBoard(
  db: Queryable,
  stopId: string,
  model: CrowdModel,
): Promise<StationBoard | null> {
  const [stop, departures] = await Promise.all([
    getStop(db, stopId),
    listDepartures(db, stopId, new Date().toISOString(), 60),
  ]);
  if (!stop) return null;

  const now = Date.now();
  const seen = new Set<string>();
  const board: UpcomingDeparture[] = [];
  for (const departure of departures) {
    const key = departure.lineId;
    const seenCount = board.filter((entry) => entry.lineId === key).length;
    if (seen.has(key) && seenCount >= 2) continue;
    seen.add(key);

    const at = new Date(departure.departureAt);
    const prediction = model.predict({
      lineId: departure.lineId,
      stopId,
      at,
      capacity: departure.vehicleCapacity || 90,
      mode: departure.mode,
      headwayMinutes: departure.headwayMinutes,
    });

    board.push({
      lineId: departure.lineId,
      lineCode: departure.lineCode,
      lineName: departure.lineName,
      lineColor: departure.lineColor,
      mode: departure.mode,
      direction: departure.direction,
      departureAt: departure.departureAt,
      minutesAway: Math.max(0, Math.round((at.getTime() - now) / 60000)),
      headwayMinutes: departure.headwayMinutes,
      vehicleCode: departure.vehicleCode,
      prediction: {
        ratio: prediction.ratio,
        level: prediction.level,
        headcount: prediction.headcount,
        capacity: departure.vehicleCapacity || 90,
        confidence: prediction.confidence,
      },
      isRecommended: prediction.ratio <= 0.6,
    });
  }

  return { stop, departures: board.slice(0, 6) };
}

function buildStats(input: {
  nextJourney: CommuterDashboard['nextJourney'];
  crowdingNow: CrowdHotspot[];
  alerts: Alert[];
  networkTotals: Record<string, number>;
  watchlist: WatchlistItem[];
}): DashboardStat[] {
  const { nextJourney, crowdingNow, alerts, networkTotals, watchlist } = input;
  const recommended: PlannerResponse | undefined = nextJourney?.planned;
  const best = recommended?.options.find((option) => option.id === recommended.recommendedOptionId);
  const worst = recommended?.options.find((option) => option.id === recommended.worstOptionId);
  const activeAlerts = alerts.filter((alert) => alert.status === 'active');

  const busiest = crowdingNow[0];

  return [
    best
      ? {
          key: 'next_departure',
          label: 'Recommended departure',
          value: formatClock(best.departAt),
          hint: `${nextJourney?.label ?? 'Next journey'} · arrives ${formatClock(best.arriveAt)}`,
          tone: 'neutral',
          icon: 'clock',
        }
      : {
          key: 'next_departure',
          label: 'Recommended departure',
          value: '—',
          hint: 'Save a journey in Settings to get live recommendations',
          tone: 'neutral',
          icon: 'clock',
        },
    best && worst && worst.crowdRisk > 0
      ? {
          key: 'crowding_saved',
          label: 'Crowding avoided',
          value: `${Math.round(best.crowdingAvoidedPct)}%`,
          hint:
            best.crowdRisk >= worst.crowdRisk
              ? `Every option on this corridor peaks near ${Math.round(
                  best.crowdRisk * 100,
                )}% — travelling outside the peak will help most`
              : `Recommended pick peaks at ${Math.round(best.crowdRisk * 100)}% vs ${Math.round(
                  worst.crowdRisk * 100,
                )}% on the busiest option`,
          tone:
            best.crowdingAvoidedPct > 15
              ? 'positive'
              : best.crowdingAvoidedPct > 5
                ? 'warning'
                : 'neutral',
          icon: 'shield',
        }
      : {
          key: 'crowding_saved',
          label: 'Crowding avoided',
          value: '—',
          hint: 'Plan a journey to compare crowd risk across options',
          tone: 'neutral',
          icon: 'shield',
        },
    busiest
      ? {
          key: 'busiest_line',
          label: 'Busiest right now',
          value: `${Math.round(busiest.ratio * 100)}%`,
          hint: `${busiest.lineCode} at ${busiest.stopName} · ${busiest.level}`,
          tone: busiest.ratio >= 0.85 ? 'negative' : busiest.ratio >= 0.6 ? 'warning' : 'positive',
          icon: 'activity',
        }
      : {
          key: 'busiest_line',
          label: 'Busiest right now',
          value: '—',
          hint: 'No live telemetry yet',
          tone: 'neutral',
          icon: 'activity',
        },
    {
      key: 'alerts',
      label: 'Active alerts',
      value: String(activeAlerts.length),
      hint: activeAlerts[0]?.title ?? 'Network running normally',
      tone: activeAlerts.some((alert) => alert.severity === 'critical')
        ? 'negative'
        : activeAlerts.length
          ? 'warning'
          : 'positive',
      icon: 'alert',
    },
    {
      key: 'saved',
      label: 'Saved journeys',
      value: String(watchlist.length),
      hint: `${networkTotals.line_count ?? 0} lines · ${
        networkTotals.stop_count ?? 0
      } stops monitored`,
      tone: 'neutral',
      icon: 'bookmark',
    },
  ];
}

async function fallbackProfile(db: Queryable, profileId: string): Promise<RiderProfile> {
  // Busiest interchange in the network acts as the guest rider's home stop.
  const [stop] = await listStops(db, { limit: 1 });
  return {
    id: profileId,
    displayName: 'Guest rider',
    email: 'guest@transitpulse.example',
    homeStopId: stop?.id ?? null,
    workStopId: null,
    homeStopName: stop?.name ?? null,
    workStopName: null,
    crowdTolerance: 0.8,
    maxWalkMinutes: 12,
    maxTransfers: 1,
    preferredModes: [],
    notifyPush: false,
    notifyEmail: false,
    notifySms: false,
    crowdThresholdAlert: 0.85,
    quietHoursStart: null,
    quietHoursEnd: null,
    theme: 'dark',
    units: 'metric',
    language: 'en',
    personalizationEnabled: false,
  };
}
