import { crowdLevelFromRatio, crowdPenalty } from '../../shared/crowd';
import type {
  ItineraryLeg,
  PlannerRequest,
  PlannerResponse,
  RecommendationKind,
  RouteOption,
  Stop,
  TransitLine,
} from '../../shared/types';
import type { Queryable } from '../db/client';
import {
  listDepartures,
  loadNetwork,
  type Departure,
  type NetworkSnapshot,
} from '../repositories/network.repo';
import { recordSearch } from '../repositories/searches.repo';
import { PLANNER_WEIGHT_DEFAULTS, getConfig, type PlannerWeights } from '../repositories/config.repo';
import { CrowdModel, type Prediction } from './crowd-model';
import { alertsForLine, listAlerts } from '../repositories/alerts.repo';
import { getProfile } from '../repositories/riders.repo';
import { env } from '../config/env';
import { haversineKm, walkMinutesForKm } from '../lib/geo';
import { addMinutes, clamp, formatClock, minutesBetween, round } from '../lib/time';

/**
 * TransitPulse recommendation engine
 * ==================================
 *
 * The planner is the heart of "Predict → Avoid → Optimize":
 *
 *  1. **Enumerate** feasible ride sequences through the network graph (loaded
 *     from Postgres) respecting the rider's transfer budget.
 *  2. **Schedule** each sequence against the real frequency-based timetable by
 *     asking the database for the next departures at every boarding stop.
 *  3. **Predict** the occupancy of every leg at the exact minute the rider
 *     would be on board, using the shared `CrowdModel`.
 *  4. **Score** each itinerary with tunable multi-objective weights stored in
 *     `model_config`, then label the winner and explain the trade-offs.
 */

/* -------------------------------------------------------------------------- */
/* Internal types                                                             */
/* -------------------------------------------------------------------------- */

interface RideSegment {
  lineId: string;
  fromStopId: string;
  toStopId: string;
  fromSeq: number;
  toSeq: number;
  /** 0 = increasing sequence, 1 = decreasing (matching `service_patterns`). */
  direction: 0 | 1;
}

interface ScheduledLeg {
  segment: RideSegment;
  boardAt: Date;
  alightAt: Date;
  departures: Departure;
  legs: ItineraryLeg;
  boardingRatio: number;
  peakRatio: number;
  peakStopName: string;
}

interface ScoredItinerary {
  rides: RideSegment[];
  scheduled: ScheduledLeg[];
  walkLegs: ItineraryLeg[];
  departAt: Date;
  arriveAt: Date;
  totalMinutes: number;
  waitMinutes: number;
  walkMinutes: number;
  transfers: number;
  crowdRisk: number;
  avgCrowdRatio: number;
  score: number;
  scoreBreakdown: { time: number; crowd: number; transfer: number; walk: number };
  fare: number;
  co2SavedKg: number;
  signature: string;
}

interface NetworkIndex {
  snapshot: NetworkSnapshot;
  stopById: Map<string, Stop>;
  lineById: Map<string, TransitLine>;
  lineStops: Map<string, { stopId: string; seq: number; offset: number }[]>;
  stopLines: Map<string, { lineId: string; seq: number; offset: number }[]>;
  walkNeighbours: Map<string, { stopId: string; minutes: number; km: number }[]>;
}

/* -------------------------------------------------------------------------- */
/* Departure lookup with in-request caching                                   */
/* -------------------------------------------------------------------------- */

class DepartureIndex {
  private cache = new Map<string, { from: number; to: number; rows: Departure[] }>();
  private readonly horizonMinutes = 150;

  constructor(private readonly db: Queryable) {}

  async next(
    stopId: string,
    fromIso: string,
    lineId: string,
    direction: 0 | 1,
  ): Promise<Departure | null> {
    const target = new Date(fromIso).getTime();
    let entry = this.cache.get(stopId);

    if (!entry || target < entry.from || target > entry.to - 25 * 60000) {
      const rows = await listDepartures(this.db, stopId, fromIso, this.horizonMinutes);
      entry = {
        from: target,
        to: target + this.horizonMinutes * 60000,
        rows,
      };
      this.cache.set(stopId, entry);
    }

    return (
      entry.rows.find(
        (row) =>
          row.lineId === lineId &&
          row.direction === direction &&
          new Date(row.departureAt).getTime() >= target - 1000,
      ) ?? null
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Network indexing                                                           */
/* -------------------------------------------------------------------------- */

function buildIndex(snapshot: NetworkSnapshot, maxWalkMinutes: number): NetworkIndex {
  const stopById = new Map(snapshot.stops.map((stop) => [stop.id, stop]));
  const lineById = new Map(snapshot.lines.map((line) => [line.id, line]));
  const lineStops = new Map<string, { stopId: string; seq: number; offset: number }[]>();
  const stopLines = new Map<string, { lineId: string; seq: number; offset: number }[]>();

  const byLine = new Map<string, { stopId: string; seq: number; travelMinutesFromPrev: number }[]>();
  for (const connection of snapshot.connections) {
    const list = byLine.get(connection.lineId) ?? [];
    list.push(connection);
    byLine.set(connection.lineId, list);
  }

  for (const [lineId, connections] of byLine) {
    connections.sort((a, b) => a.seq - b.seq);
    let offset = 0;
    const entries: { stopId: string; seq: number; offset: number }[] = [];
    connections.forEach((connection, index) => {
      if (index > 0) offset += connection.travelMinutesFromPrev;
      entries.push({ stopId: connection.stopId, seq: connection.seq, offset });
    });
    lineStops.set(lineId, entries);
    for (const entry of entries) {
      const list = stopLines.get(entry.stopId) ?? [];
      list.push({ lineId, seq: entry.seq, offset: entry.offset });
      stopLines.set(entry.stopId, list);
    }
  }

  // Walking transfers between stops that are close enough to be worth it.
  const walkNeighbours = new Map<string, { stopId: string; minutes: number; km: number }[]>();
  const stops = snapshot.stops;
  for (const from of stops) {
    const neighbours: { stopId: string; minutes: number; km: number }[] = [];
    for (const to of stops) {
      if (from.id === to.id) continue;
      const km = haversineKm(from, to);
      const minutes = walkMinutesForKm(km);
      if (minutes <= maxWalkMinutes && km <= 1.6) {
        neighbours.push({ stopId: to.id, minutes, km: round(km, 3) });
      }
    }
    neighbours.sort((a, b) => a.minutes - b.minutes);
    walkNeighbours.set(from.id, neighbours.slice(0, 4));
  }

  return { snapshot, stopById, lineById, lineStops, stopLines, walkNeighbours };
}

/* -------------------------------------------------------------------------- */
/* Ride sequence enumeration                                                  */
/* -------------------------------------------------------------------------- */

function enumerateRides(
  index: NetworkIndex,
  originStopId: string,
  destinationStopId: string,
  maxTransfers: number,
  limit = 80,
): RideSegment[][] {
  const results: RideSegment[][] = [];
  const seen = new Set<string>();

  const push = (rides: RideSegment[]): void => {
    const signature = rides.map((ride) => `${ride.lineId}:${ride.toStopId}`).join('>');
    if (seen.has(signature)) return;
    seen.add(signature);
    results.push(rides);
  };

  const visit = (
    currentStopId: string,
    rides: RideSegment[],
    usedLines: Set<string>,
    transfersLeft: number,
  ): void => {
    if (results.length >= limit) return;

    const linesHere = index.stopLines.get(currentStopId) ?? [];
    for (const { lineId, seq } of linesHere) {
      if (usedLines.has(lineId)) continue;
      const stopsOnLine = index.lineStops.get(lineId) ?? [];

      for (const candidate of stopsOnLine) {
        if (candidate.stopId === currentStopId) continue;
        const segment: RideSegment = {
          lineId,
          fromStopId: currentStopId,
          toStopId: candidate.stopId,
          fromSeq: seq,
          toSeq: candidate.seq,
          direction: candidate.seq > seq ? 0 : 1,
        };

        if (candidate.stopId === destinationStopId) {
          push([...rides, segment]);
          continue;
        }

        if (transfersLeft <= 0) continue;

        // Transfer only where another line can actually take the rider further.
        const onward = (index.stopLines.get(candidate.stopId) ?? []).some(
          (entry) => !usedLines.has(entry.lineId) && entry.lineId !== lineId,
        );
        if (!onward && index.walkNeighbours.get(candidate.stopId)?.length === 0) continue;

        const nextUsed = new Set(usedLines);
        nextUsed.add(lineId);

        if (onward) {
          visit(candidate.stopId, [...rides, segment], nextUsed, transfersLeft - 1);
        }

        // Walking transfer: leave the network and re-enter at a nearby stop.
        for (const neighbour of index.walkNeighbours.get(candidate.stopId) ?? []) {
          if (usedLines.has(lineId)) continue;
          const neighbourLines = (index.stopLines.get(neighbour.stopId) ?? []).filter(
            (entry) => !nextUsed.has(entry.lineId),
          );
          if (!neighbourLines.length) continue;

          for (const entry of neighbourLines) {
            const onwardStops = index.lineStops.get(entry.lineId) ?? [];
            for (const target of onwardStops) {
              if (target.stopId === neighbour.stopId || target.stopId === currentStopId) continue;
              const walkSegment: RideSegment = {
                lineId: entry.lineId,
                fromStopId: neighbour.stopId,
                toStopId: target.stopId,
                fromSeq: entry.seq,
                toSeq: target.seq,
                direction: target.seq > entry.seq ? 0 : 1,
              };
              if (target.stopId === destinationStopId) {
                push([...rides, segment, walkSegment]);
              } else if (transfersLeft > 1) {
                const deeperUsed = new Set([...nextUsed, entry.lineId]);
                visit(target.stopId, [...rides, segment, walkSegment], deeperUsed, transfersLeft - 2);
              }
            }
          }
        }
      }
    }
  };

  visit(originStopId, [], new Set(), maxTransfers);
  return results;
}

/* -------------------------------------------------------------------------- */
/* Itinerary construction + scoring                                           */
/* -------------------------------------------------------------------------- */

interface EvaluateContext {
  index: NetworkIndex;
  departures: DepartureIndex;
  model: CrowdModel;
  weights: PlannerWeights;
  crowdWeightScale: number;
}

async function evaluate(
  rides: RideSegment[],
  context: EvaluateContext,
  departAfter: Date,
): Promise<ScoredItinerary | null> {
  const { index, departures, model, weights } = context;
  const scheduled: ScheduledLeg[] = [];
  const walkLegs: ItineraryLeg[] = [];

  let cursor = departAfter;
  let waitMinutes = 0;
  let walkMinutes = 0;
  let crowdRisk = 0;
  let weightedRatioSum = 0;
  let durationSum = 0;
  let distanceKm = 0;

  for (const ride of rides) {
    const line = index.lineById.get(ride.lineId);
    if (!line) return null;

    const departure = await departures.next(
      ride.fromStopId,
      cursor.toISOString(),
      ride.lineId,
      ride.direction,
    );
    if (!departure) return null;

    const boardAt = new Date(departure.departureAt);
    if (boardAt.getTime() < departAfter.getTime() - 1000) return null;

    const stopsOnLine = index.lineStops.get(ride.lineId) ?? [];
    const fromEntry = stopsOnLine.find((entry) => entry.stopId === ride.fromStopId);
    const toEntry = stopsOnLine.find((entry) => entry.stopId === ride.toStopId);
    if (!fromEntry || !toEntry) return null;

    const durationMinutes = Math.abs(toEntry.offset - fromEntry.offset);
    const alightAt = addMinutes(boardAt, durationMinutes);

    const path = stopsOnLine
      .filter((entry) =>
        ride.direction === 0
          ? entry.seq >= fromEntry.seq && entry.seq <= toEntry.seq
          : entry.seq <= fromEntry.seq && entry.seq >= toEntry.seq,
      )
      .sort((a, b) => (ride.direction === 0 ? a.seq - b.seq : b.seq - a.seq));

    const timeline: ItineraryLeg['stops'] = [];
    let boarding: Prediction | null = null;
    let peak = 0;
    let peakStopName = index.stopById.get(ride.fromStopId)?.name ?? '';

    for (const entry of path) {
      const minutesIn = Math.abs(entry.offset - fromEntry.offset);
      const at = addMinutes(boardAt, minutesIn);
      const upstreamRatio = boarding ? Math.min(0.95, boarding.ratio * 0.82) : 0;

      const prediction = model.predict({
        lineId: ride.lineId,
        stopId: entry.stopId,
        at,
        capacity: line.capacityPerVehicle,
        mode: line.mode,
        headwayMinutes: line.headwayMinutes,
        upstreamRatio,
      });

      if (!boarding) boarding = prediction;
      if (prediction.ratio > peak) {
        peak = prediction.ratio;
        peakStopName = index.stopById.get(entry.stopId)?.name ?? peakStopName;
      }

      timeline.push({
        stopId: entry.stopId,
        name: index.stopById.get(entry.stopId)?.name ?? entry.stopId,
        etaMinutes: minutesIn,
      });
    }

    // Distance travelled on this leg, for the CO₂ comparison.
    for (let i = 1; i < path.length; i += 1) {
      const a = index.stopById.get(path[i - 1].stopId);
      const b = index.stopById.get(path[i].stopId);
      if (a && b) distanceKm += haversineKm(a, b);
    }

    const boardingPrediction =
      boarding ??
      model.predict({
        lineId: ride.lineId,
        stopId: ride.fromStopId,
        at: boardAt,
        capacity: line.capacityPerVehicle,
        mode: line.mode,
        headwayMinutes: line.headwayMinutes,
      });

    const leg: ItineraryLeg = {
      kind: 'transit',
      lineId: line.id,
      lineCode: line.code,
      lineName: line.name,
      lineColor: line.color,
      mode: line.mode,
      fromStopId: ride.fromStopId,
      fromStopName: index.stopById.get(ride.fromStopId)?.name ?? ride.fromStopId,
      toStopId: ride.toStopId,
      toStopName: index.stopById.get(ride.toStopId)?.name ?? ride.toStopId,
      departAt: boardAt.toISOString(),
      arriveAt: alightAt.toISOString(),
      durationMinutes,
      stopCount: Math.max(0, path.length - 1),
      stops: timeline,
      crowd: {
        ratio: boardingPrediction.ratio,
        level: boardingPrediction.level,
        headcount: boardingPrediction.headcount,
        capacity: line.capacityPerVehicle,
        confidence: boardingPrediction.confidence,
        peakRatio: round(peak, 3),
        peakStopName,
      },
    };

    waitMinutes += Math.max(0, minutesBetween(cursor, boardAt));
    scheduled.push({
      segment: ride,
      boardAt,
      alightAt,
      departures: departure,
      legs: leg,
      boardingRatio: boardingPrediction.ratio,
      peakRatio: round(peak, 3),
      peakStopName,
    });

    if (peak > crowdRisk) crowdRisk = peak;
    weightedRatioSum += boardingPrediction.ratio * Math.max(durationMinutes, 1);
    durationSum += Math.max(durationMinutes, 1);

    cursor = alightAt;
  }

  // Transfers: walking time between consecutive boarding stops.
  for (let i = 1; i < scheduled.length; i += 1) {
    const previous = scheduled[i - 1];
    const next = scheduled[i];
    const fromStop = index.stopById.get(previous.legs.toStopId);
    const toStop = index.stopById.get(next.legs.fromStopId);
    if (!fromStop || !toStop) continue;

    if (fromStop.id !== toStop.id) {
      const km = haversineKm(fromStop, toStop);
      const minutes = walkMinutesForKm(km);
      walkMinutes += minutes;
      walkLegs.push({
        kind: 'walk',
        fromStopId: fromStop.id,
        fromStopName: fromStop.name,
        toStopId: toStop.id,
        toStopName: toStop.name,
        departAt: previous.alightAt.toISOString(),
        arriveAt: addMinutes(previous.alightAt, minutes).toISOString(),
        durationMinutes: minutes,
        stopCount: 0,
        stops: [
          { stopId: fromStop.id, name: fromStop.name, etaMinutes: 0 },
          { stopId: toStop.id, name: toStop.name, etaMinutes: minutes },
        ],
      });
    }
  }

  const first = scheduled[0];
  const last = scheduled[scheduled.length - 1];
  if (!first || !last) return null;

  const arriveAt = last.alightAt;
  const totalMinutes = Math.max(1, minutesBetween(first.boardAt, arriveAt));
  const avgCrowdRatio = durationSum > 0 ? round(weightedRatioSum / durationSum, 3) : crowdRisk;
  const expectation = round(0.6 * avgCrowdRatio + 0.4 * crowdRisk, 3);
  const transfers = scheduled.length - 1;

  const scoreBreakdown = {
    time: round(totalMinutes * weights.time, 3),
    crowd: round(crowdPenalty(expectation) * weights.crowd * context.crowdWeightScale, 3),
    transfer: round(transfers * weights.transfer, 3),
    walk: round(walkMinutes * weights.walk, 3),
  };
  const score = round(
    scoreBreakdown.time + scoreBreakdown.crowd + scoreBreakdown.transfer + scoreBreakdown.walk,
    3,
  );

  const fare = round(weights.defaultFare + transfers * 0.85, 2);

  return {
    rides,
    scheduled,
    walkLegs,
    departAt: first.boardAt,
    arriveAt,
    totalMinutes,
    waitMinutes,
    walkMinutes,
    transfers,
    crowdRisk: round(crowdRisk, 3),
    avgCrowdRatio,
    score,
    scoreBreakdown,
    fare,
    co2SavedKg: round(distanceKm * weights.co2PerKmSavedKg, 2),
    signature: scheduled
      .map((leg) => `${leg.segment.lineId}@${formatClock(leg.boardAt)}=>${leg.segment.toStopId}`)
      .join('|'),
  };
}

/* -------------------------------------------------------------------------- */
/* Narrative generation                                                       */
/* -------------------------------------------------------------------------- */

function buildHeadline(option: ScoredItinerary, kind: RecommendationKind, worstRisk: number): string {
  const boarding = option.scheduled[0];
  const clock = formatClock(boarding.boardAt);
  const savedPct = worstRisk > 0 ? Math.round(((worstRisk - option.crowdRisk) / worstRisk) * 100) : 0;

  switch (kind) {
    case 'quietest':
      return savedPct > 4
        ? `Quietest carriage — ${savedPct}% lighter than the busiest option`
        : `Quietest carriage available at ${clock}`;
    case 'fastest':
      return `Fastest door-to-door at ${option.totalMinutes} min, boarding ${clock}`;
    case 'fewest_transfers':
      return option.transfers === 0
        ? 'Single-seat ride — no changes needed'
        : `Only ${option.transfers} change${option.transfers > 1 ? 's' : ''} for this journey`;
    default:
      return savedPct > 8
        ? `Best balance: boards ${clock}, ${savedPct}% less crowded than the worst option`
        : `Best balance of time and crowding, boarding ${clock}`;
  }
}

function buildRationale(option: ScoredItinerary, index: NetworkIndex): string[] {
  const lines: string[] = [];
  const first = option.scheduled[0];

  lines.push(
    `Departs ${formatClock(option.departAt)} · arrives ${formatClock(option.arriveAt)} ` +
      `(${option.totalMinutes} min door-to-door)`,
  );

  const boardingStop = index.stopById.get(first.legs.fromStopId)?.name ?? first.legs.fromStopId;
  lines.push(
    `Boards ${first.legs.lineCode} ${first.legs.lineName} at ${boardingStop} — predicted ` +
      `${Math.round(first.boardingRatio * 100)}% full`,
  );

  if (option.transfers === 0) {
    lines.push('Direct service — no changes, no transfer walk');
  } else {
    const changes = option.scheduled
      .slice(1)
      .map((leg) => `${leg.legs.lineCode} at ${index.stopById.get(leg.legs.fromStopId)?.name ?? ''}`.trim());
    lines.push(`${option.transfers} change${option.transfers > 1 ? 's' : ''}: ${changes.join(', ')}`);
  }

  const busiest = option.scheduled.reduce(
    (worst, leg) => (leg.peakRatio > worst.peakRatio ? leg : worst),
    option.scheduled[0],
  );
  if (busiest.peakRatio >= 0.8) {
    lines.push(
      `Heads up: the ${busiest.legs.lineCode} stretch past ${busiest.peakStopName} is predicted at ` +
        `${Math.round(busiest.peakRatio * 100)}%`,
    );
  } else {
    lines.push(
      `Worst stretch on this itinerary is ${Math.round(busiest.peakRatio * 100)}% — ` +
        `${crowdLevelFromRatio(busiest.peakRatio)} crowding`,
    );
  }

  if (option.walkMinutes > 0) {
    lines.push(`${option.walkMinutes} min of walking/waiting between services`);
  }

  return lines;
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

export interface PlannerContext {
  profileId?: string;
}

export async function planJourney(
  db: Queryable,
  request: PlannerRequest,
): Promise<PlannerResponse | null> {
  const weights = await getConfig<PlannerWeights>(db, 'planner_weights', PLANNER_WEIGHT_DEFAULTS);
  const snapshot = await loadNetwork(db);
  const stopById = new Map(snapshot.stops.map((stop) => [stop.id, stop]));

  const origin = stopById.get(request.originStopId);
  const destination = stopById.get(request.destinationStopId);
  if (!origin || !destination || origin.id === destination.id) return null;

  const profile = request.profileId ? await getProfile(db, request.profileId) : null;
  const maxWalkMinutes = request.maxWalkMinutes ?? profile?.maxWalkMinutes ?? 12;
  const maxTransfers = clamp(request.maxTransfers ?? profile?.maxTransfers ?? 1, 0, 3);
  const tolerance = clamp(request.crowdTolerance ?? profile?.crowdTolerance ?? 0.8, 0, 1.5);
  const avoidCrowding = request.avoidCrowding ?? true;

  const crowdWeightScale = avoidCrowding ? clamp(0.6 + (1 - tolerance) * 0.9, 0.35, 1.6) : 0.3;

  const index = buildIndex(snapshot, maxWalkMinutes);
  const model = await CrowdModel.load(db, snapshot.lines.map((line) => line.id));
  const departures = new DepartureIndex(db);
  const departAfter = request.departAfter ? new Date(request.departAfter) : new Date();

  const sequences = enumerateRides(
    index,
    origin.id,
    destination.id,
    maxTransfers,
    Math.max(12, weights.maxOptions * 12),
  );

  const context: EvaluateContext = {
    index,
    departures,
    model,
    weights,
    crowdWeightScale,
  };

  const evaluated: ScoredItinerary[] = [];
  for (const rides of sequences) {
    const itinerary = await evaluate(rides, context, departAfter);
    if (itinerary) evaluated.push(itinerary);
  }

  if (!evaluated.length) {
    return {
      origin,
      destination,
      departAfter: departAfter.toISOString(),
      generatedAt: new Date().toISOString(),
      modelVersion: env.modelVersion,
      options: [],
      recommendedOptionId: '',
      worstOptionId: '',
      searchId: null,
      insights: ['No service connects these stops within the selected transfer limit.'],
    };
  }

  // Keep distinct itineraries, ranked by the tuned objective. The result set is
  // capped at the number of recommendation lenses so every option can carry a
  // meaningful, unique badge.
  const bySignature = new Map<string, ScoredItinerary>();
  for (const itinerary of evaluated.sort((a, b) => a.score - b.score)) {
    if (!bySignature.has(itinerary.signature)) bySignature.set(itinerary.signature, itinerary);
  }
  const lensCount = 4;
  const ranked = [...bySignature.values()].slice(
    0,
    clamp(weights.maxOptions, 2, lensCount),
  );

  const worstRisk = Math.max(...ranked.map((itinerary) => itinerary.crowdRisk));

  /** Assign each recommendation lens to the itinerary that wins on that metric. */
  const lensFor = new Map<string, RecommendationKind>();
  lensFor.set(ranked[0].signature, 'best');

  const lenses: {
    kind: RecommendationKind;
    compare: (a: ScoredItinerary, b: ScoredItinerary) => number;
  }[] = [
    { kind: 'quietest', compare: (a, b) => a.crowdRisk - b.crowdRisk || a.score - b.score },
    { kind: 'fastest', compare: (a, b) => a.totalMinutes - b.totalMinutes || a.score - b.score },
    {
      kind: 'fewest_transfers',
      compare: (a, b) => a.transfers - b.transfers || a.totalMinutes - b.totalMinutes || a.score - b.score,
    },
  ];

  for (const lens of lenses) {
    const winner = [...ranked].sort(lens.compare).find((option) => !lensFor.has(option.signature));
    if (winner) lensFor.set(winner.signature, lens.kind);
  }

  const badgeLabels: Record<RecommendationKind, string> = {
    best: 'Recommended',
    fastest: 'Fastest',
    quietest: 'Quietest',
    fewest_transfers: 'Fewest changes',
  };

  const options: RouteOption[] = ranked.map((itinerary, position) => {
    const kind = lensFor.get(itinerary.signature) ?? 'quietest';
    const legs = [...itinerary.scheduled.map((leg) => leg.legs), ...itinerary.walkLegs].sort(
      (a, b) => new Date(a.departAt).getTime() - new Date(b.departAt).getTime(),
    );

    return {
      id: `opt-${kind}-${position}`,
      kind,
      badgeLabel: badgeLabels[kind],
      headline: buildHeadline(itinerary, kind, worstRisk),
      rationale: buildRationale(itinerary, index),
      departAt: itinerary.departAt.toISOString(),
      arriveAt: itinerary.arriveAt.toISOString(),
      totalMinutes: itinerary.totalMinutes,
      walkMinutes: itinerary.walkMinutes,
      waitMinutes: itinerary.waitMinutes,
      transfers: itinerary.transfers,
      fare: itinerary.fare,
      co2SavedKg: itinerary.co2SavedKg,
      score: itinerary.score,
      scoreBreakdown: itinerary.scoreBreakdown,
      crowdRisk: itinerary.crowdRisk,
      crowdRiskLevel: crowdLevelFromRatio(itinerary.crowdRisk),
      avgCrowdRatio: itinerary.avgCrowdRatio,
      legs,
      crowdingAvoidedPct:
        worstRisk > 0 ? round(((worstRisk - itinerary.crowdRisk) / worstRisk) * 100, 1) : 0,
    };
  });

  const recommended = options.find((option) => option.kind === 'best') ?? options[0];
  const worstOption = [...options].sort((a, b) => b.crowdRisk - a.crowdRisk)[0];

  /* ---------------------------------------------------------------- insights */
  const insights: string[] = [];

  // Optimize: would leaving a little later be materially quieter?
  const firstRide = ranked[0].rides[0];
  const nextDeparture = await departures.next(
    firstRide.fromStopId,
    addMinutes(ranked[0].departAt, 3).toISOString(),
    firstRide.lineId,
    firstRide.direction,
  );
  if (nextDeparture) {
    const laterAt = new Date(nextDeparture.departureAt);
    const line = index.lineById.get(firstRide.lineId);
    if (line) {
      const laterPrediction = model.predict({
        lineId: line.id,
        stopId: firstRide.fromStopId,
        at: laterAt,
        capacity: line.capacityPerVehicle,
        mode: line.mode,
        headwayMinutes: line.headwayMinutes,
      });
      const delta = ranked[0].scheduled[0].boardingRatio - laterPrediction.ratio;
      if (delta > 0.06) {
        insights.push(
          `Optimize: leaving ${formatClock(laterAt)} instead of ${formatClock(ranked[0].departAt)} ` +
            `is about ${Math.round(delta * 100)} points quieter on ${line.code}.`,
        );
      } else if (delta < -0.06) {
        insights.push(
          `Optimize: the ${formatClock(ranked[0].departAt)} service is ${Math.round(-delta * 100)} ` +
            `points quieter than the next one — boarding now is the better move.`,
        );
      }
    }
  }

  // Avoid: how much does the recommendation save versus the busiest option?
  if (worstOption && worstOption.id !== recommended.id && recommended.crowdingAvoidedPct >= 5) {
    insights.push(
      `Avoid: the busiest option on this corridor peaks at ${Math.round(worstOption.crowdRisk * 100)}% — ` +
        `this recommendation avoids ${Math.round(recommended.crowdingAvoidedPct)}% of that crowding.`,
    );
  } else if (recommended.crowdRisk > 0) {
    insights.push(
      `Avoid: every option on this corridor peaks near ${Math.round(
        recommended.crowdRisk * 100,
      )}% — shifting the departure window helps more than switching lines.`,
    );
  }

  const lineAlerts = await Promise.all(
    [...new Set(options.flatMap((option) => option.legs.map((leg) => leg.lineId)).filter(Boolean))].map(
      (lineId) => alertsForLine(db, lineId as string),
    ),
  );
  const relevantAlert = lineAlerts.flat().find((alert) => alert.status === 'active');
  if (relevantAlert) {
    insights.push(`Service notice: ${relevantAlert.title} (${relevantAlert.severity}).`);
  }

  const busiestLine = ranked[0].scheduled.reduce(
    (worst, leg) => (leg.peakRatio > worst.peakRatio ? leg : worst),
    ranked[0].scheduled[0],
  );
  if (busiestLine.peakRatio >= 0.85) {
    insights.push(
      `Predict: ${busiestLine.legs.lineCode} is forecast at ` +
        `${Math.round(busiestLine.peakRatio * 100)}% past ${busiestLine.peakStopName} — plan for standing room.`,
    );
  }

  const crowdingAlerts = await listAlerts(db, { status: 'active', limit: 20 });
  const crowdingCount = crowdingAlerts.filter((alert) => alert.category === 'crowding').length;
  if (crowdingCount > 1) {
    insights.push(
      `${crowdingCount} active crowding alerts across the network are factored into these predictions.`,
    );
  }

  /* --------------------------------------------------------------- persistence */
  let searchId: number | null = null;
  if (request.persist === false) {
    return {
      origin,
      destination,
      departAfter: departAfter.toISOString(),
      generatedAt: new Date().toISOString(),
      modelVersion: env.modelVersion,
      options,
      recommendedOptionId: recommended.id,
      worstOptionId: worstOption?.id ?? recommended.id,
      searchId,
      insights,
    };
  }

  try {
    searchId = await recordSearch(db, {
      profileId: request.profileId ?? null,
      originStopId: origin.id,
      destinationStopId: destination.id,
      departAfter: departAfter.toISOString(),
      avoidCrowding,
      recommendedOptionId: recommended.id,
      options: options.map((option) => ({
        id: option.id,
        kind: option.kind,
        totalMinutes: option.totalMinutes,
        transfers: option.transfers,
        crowdRisk: option.crowdRisk,
        avgCrowdRatio: option.avgCrowdRatio,
        score: option.score,
        crowdingAvoidedPct: option.crowdingAvoidedPct,
        legs: option.legs,
      })),
    });
  } catch (error) {
    console.warn('[planner] failed to persist search history:', (error as Error).message);
  }

  return {
    origin,
    destination,
    departAfter: departAfter.toISOString(),
    generatedAt: new Date().toISOString(),
    modelVersion: env.modelVersion,
    options,
    recommendedOptionId: recommended.id,
    worstOptionId: worstOption?.id ?? recommended.id,
    searchId,
    insights,
  };
}
