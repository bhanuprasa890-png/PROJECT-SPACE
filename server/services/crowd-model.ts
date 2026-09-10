import { crowdLevelFromRatio, CROWD_LEVEL_META } from '../../shared/crowd';
import type {
  CrowdForecastPoint,
  CrowdLevel,
  ForecastFactor,
  ForecastSeries,
  TransitMode,
} from '../../shared/types';
import type { Queryable } from '../db/client';
import {
  MODEL_DEFAULTS,
  getConfig,
  type CrowdModelConfig,
} from '../repositories/config.repo';
import {
  listBaselines,
  listPersistedForecasts,
  listRecentObservations,
  upsertForecasts,
  type BaselineCell,
} from '../repositories/crowd.repo';
import { alertsForLine } from '../repositories/alerts.repo';
import { getLineByIdOrCode, getStop } from '../repositories/network.repo';
import { clamp, dayTypeFor, fractionalHour, minutesBetween, round } from '../lib/time';

/**
 * TransitPulse crowd model
 * ========================
 *
 * A transparent, explainable occupancy model. It blends four signals:
 *
 *   1. **Learned baseline** — the 14-day hourly mean *and* 90th percentile of
 *      `crowd_observations` for this exact line/stop/day-type/hour cell.
 *   2. **Continuity** — smooth interpolation between the current and next hour
 *      so the curve does not step at :59.
 *   3. **Service pressure** — short headways bunch passengers onto fewer
 *      vehicles; long headways spread them out.
 *   4. **Live context** — active crowding alerts and upstream load carried down
 *      the line.
 *
 * Every prediction returns the per-factor contributions that produced it, which
 * is what the Route Details screen renders as "why this prediction".
 */

export interface Prediction {
  ratio: number;
  headcount: number;
  level: CrowdLevel;
  confidence: number;
  lower: number;
  upper: number;
  factors: ForecastFactor[];
  /** Ratio the model would report with live context stripped out. */
  baselineRatio: number;
}

export interface PredictParams {
  lineId: string;
  stopId: string;
  at: Date;
  capacity: number;
  mode?: TransitMode;
  headwayMinutes?: number;
  /** Occupancy ratio already on board when the vehicle reaches this stop. */
  upstreamRatio?: number;
  timeZone?: string;
}

interface BaselineCellLookup {
  byStop: Map<string, BaselineCell>;
  byLine: Map<string, BaselineCell>;
}

const cellKey = (lineId: string, stopId: string | null, dayType: string, hour: number): string =>
  `${lineId}|${stopId ?? '*'}|${dayType}|${hour}`;

/**
 * Prior demand curve used only when the database has no observations for a
 * cell (e.g. a brand-new line). Learned data always wins.
 */
const PRIOR_CURVE: Record<number, number> = {
  5: 0.4, 6: 0.62, 7: 1.0, 8: 1.26, 9: 1.04, 10: 0.78, 11: 0.72, 12: 0.78,
  13: 0.82, 14: 0.74, 15: 0.8, 16: 0.94, 17: 1.18, 18: 1.28, 19: 0.96,
  20: 0.72, 21: 0.56, 22: 0.44, 23: 0.32,
};

const MODE_BASE: Record<TransitMode, number> = {
  metro: 0.5,
  bus: 0.46,
  tram: 0.42,
  brt: 0.48,
  ferry: 0.34,
};

export class CrowdModel {
  private readonly baseline: BaselineCellLookup;
  private readonly pressure: Map<string, number>;

  constructor(
    cells: BaselineCell[],
    private readonly config: CrowdModelConfig,
    pressureByLine: Map<string, number> = new Map(),
  ) {
    const byStop = new Map<string, BaselineCell>();
    const byLine = new Map<string, BaselineCell>();

    for (const cell of cells) {
      if (cell.stopId) {
        byStop.set(cellKey(cell.lineId, cell.stopId, cell.dayType, cell.hourOfDay), cell);
      } else {
        byLine.set(cellKey(cell.lineId, null, cell.dayType, cell.hourOfDay), cell);
      }
    }

    this.baseline = { byStop, byLine };
    this.pressure = pressureByLine;
  }

  static async load(db: Queryable, lineIds?: string[]): Promise<CrowdModel> {
    const config = await getConfig<CrowdModelConfig>(db, 'crowd_model', MODEL_DEFAULTS);
    const cells = await listBaselines(db, { lineIds });
    return new CrowdModel(cells, config);
  }

  /** Mean occupancy for a baseline cell, falling back to the line-wide cell. */
  private cell(
    lineId: string,
    stopId: string,
    dayType: string,
    hour: number,
  ): { avg: number; p90: number; sampleSize: number; scope: 'stop' | 'line' | 'prior' } | null {
    const hourNorm = ((hour % 24) + 24) % 24;
    const stopCell = this.baseline.byStop.get(cellKey(lineId, stopId, dayType, hourNorm));
    if (stopCell) {
      return {
        avg: stopCell.avgRatio,
        p90: stopCell.p90Ratio,
        sampleSize: stopCell.sampleSize,
        scope: 'stop',
      };
    }
    const lineCell = this.baseline.byLine.get(cellKey(lineId, null, dayType, hourNorm));
    if (lineCell) {
      return {
        avg: lineCell.avgRatio,
        p90: lineCell.p90Ratio,
        sampleSize: lineCell.sampleSize,
        scope: 'line',
      };
    }
    return null;
  }

  private priorFor(hour: number, mode: TransitMode, dayType: string): number {
    const weekend = dayType !== 'weekday';
    const raw = PRIOR_CURVE[hour] ?? 0.4;
    // Weekend demand is flatter and peaks later in the day.
    const adjusted = weekend ? 0.55 + raw * 0.45 : raw;
    return clamp(MODE_BASE[mode] * adjusted, 0.08, 1.1);
  }

  /**
   * Predicts occupancy for a line/stop at an instant in the future.
   * Returns both the value and the reason it was produced.
   */
  predict(params: PredictParams): Prediction {
    const { lineId, stopId, at, capacity } = params;
    const timeZone = params.timeZone ?? 'UTC';
    const dayType = dayTypeFor(at, timeZone);
    const fHour = fractionalHour(at, timeZone);
    const hour = Math.floor(fHour);
    const fraction = fHour - hour;

    const current = this.cell(lineId, stopId, dayType, hour);
    const next = this.cell(lineId, stopId, dayType, hour + 1);
    const mode: TransitMode = params.mode ?? 'metro';

    const currentAvg = current?.avg ?? this.priorFor(hour, mode, dayType);
    const nextAvg = next?.avg ?? currentAvg;
    const currentP90 = current?.p90 ?? currentAvg * 1.12;
    const nextP90 = next?.p90 ?? currentP90;

    // (1) + (2) learned baseline, interpolated across the hour boundary.
    const mean = currentAvg + (nextAvg - currentAvg) * fraction;
    const peak = currentP90 + (nextP90 - currentP90) * fraction;
    const blended = mean * 0.68 + peak * 0.32;

    const factors: ForecastFactor[] = [
      {
        key: 'baseline',
        label: 'Learned demand for this hour',
        contribution: round(blended, 3),
        detail:
          current?.scope === 'stop'
            ? `14-day average at ${Math.round(blended * 100)}% occupancy (${current.sampleSize} samples)`
            : 'Line-wide average — no stop-level history yet',
      },
    ];

    // (3) headway pressure: 8 minutes is the reference headway.
    const headway = params.headwayMinutes ?? 8;
    const headwayFactor = clamp(8 / Math.max(headway, 1), 0.88, 1.12);
    const headwayContribution = blended * (headwayFactor - 1);
    factors.push({
      key: 'headway',
      label: 'Service frequency pressure',
      contribution: round(headwayContribution, 3),
      detail:
        headwayFactor > 1
          ? `${headway} min headway packs more riders into each service`
          : `${headway} min headway spreads demand across services`,
    });

    // (4) live context: crowding alerts and upstream carry-over.
    const alertBoost = this.pressure.get(lineId) ?? 0;
    const upstream = params.upstreamRatio ?? 0;
    const upstreamContribution = upstream > 0 ? upstream * 0.14 : 0;

    if (alertBoost > 0) {
      factors.push({
        key: 'alerts',
        label: 'Active crowding alerts',
        contribution: round(alertBoost, 3),
        detail: 'Operational notice on this line raises the expected load',
      });
    }
    if (upstreamContribution > 0) {
      factors.push({
        key: 'upstream',
        label: 'Upstream carry-over',
        contribution: round(upstreamContribution, 3),
        detail: `Vehicle already ${Math.round(upstream * 100)}% full when it arrives`,
      });
    }

    const ratio = clamp(blended + headwayContribution + alertBoost + upstreamContribution, 0.04, 1.4);

    const horizonMinutes = Math.max(0, minutesBetween(new Date(), at));
    // Confidence grows with the number of historical samples behind the cell,
    // then decays with the forecast horizon.
    const sampleConfidence = current ? clamp(0.74 + current.sampleSize / 45, 0.74, 1) : 0.66;
    const confidence = clamp(
      (0.97 - horizonMinutes * 0.0018) * sampleConfidence,
      this.config.confidenceFloor,
      0.97,
    );

    return {
      ratio: round(ratio, 3),
      headcount: Math.max(1, Math.round(ratio * capacity)),
      level: crowdLevelFromRatio(ratio),
      confidence: round(confidence, 3),
      lower: round(clamp(ratio * (1 - 0.16 - horizonMinutes / 1400), 0, 1.5), 3),
      upper: round(clamp(ratio * (1 + 0.18 + horizonMinutes / 1100), 0, 1.6), 3),
      factors,
      baselineRatio: round(blended, 3),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Forecast series for the "Route details" screen                            */
/* -------------------------------------------------------------------------- */

export interface ForecastRequest {
  lineIdOrCode: string;
  stopId: string;
  horizonMinutes?: number;
  /** Persist the generated series into `crowd_forecasts`. */
  persist?: boolean;
  now?: Date;
}

export async function buildForecastSeries(
  db: Queryable,
  request: ForecastRequest,
): Promise<ForecastSeries | null> {
  const [line, stop] = await Promise.all([
    getLineByIdOrCode(db, request.lineIdOrCode),
    getStop(db, request.stopId),
  ]);
  if (!line || !stop) return null;

  const config = await getConfig<CrowdModelConfig>(db, 'crowd_model', MODEL_DEFAULTS);
  const horizon = request.horizonMinutes ?? config.horizonMinutes;
  const step = config.stepMinutes;
  const now = request.now ?? new Date();

  const [baselines, alerts, history] = await Promise.all([
    listBaselines(db, { lineIds: [line.id] }),
    alertsForLine(db, line.id),
    listRecentObservations(db, { lineId: line.id, stopId: stop.id, hours: 26, limit: 80 }),
  ]);

  const pressure = new Map<string, number>();
  const crowdingAlerts = alerts.filter((alert) => alert.category === 'crowding');
  if (crowdingAlerts.length) {
    pressure.set(line.id, Math.min(0.09, crowdingAlerts.length * 0.035));
  }

  const model = new CrowdModel(baselines, config, pressure);

  const persisted = await listPersistedForecasts(db, {
    lineId: line.id,
    stopId: stop.id,
    fromIso: now.toISOString(),
    toIso: new Date(now.getTime() + horizon * 60000).toISOString(),
  });
  const persistedByMinute = new Map(
    persisted.map((row) => [Math.round(row.horizonMinutes / step) * step, row]),
  );

  const points: CrowdForecastPoint[] = [];
  for (let offset = step; offset <= horizon; offset += step) {
    const targetAt = new Date(now.getTime() + offset * 60000);
    const stored = persistedByMinute.get(offset);
    if (stored) {
      points.push({
        targetAt: targetAt.toISOString(),
        horizonMinutes: offset,
        ratio: stored.ratio,
        headcount: stored.headcount,
        capacity: line.capacityPerVehicle,
        level: crowdLevelFromRatio(stored.ratio),
        confidence: stored.confidence,
        lower: round(clamp(stored.ratio * 0.86, 0, 1.5), 3),
        upper: round(clamp(stored.ratio * 1.16, 0, 1.6), 3),
      });
      continue;
    }

    const prediction = model.predict({
      lineId: line.id,
      stopId: stop.id,
      at: targetAt,
      capacity: line.capacityPerVehicle,
      headwayMinutes: line.headwayMinutes,
    });

    points.push({
      targetAt: targetAt.toISOString(),
      horizonMinutes: offset,
      ratio: prediction.ratio,
      headcount: prediction.headcount,
      capacity: line.capacityPerVehicle,
      level: prediction.level,
      confidence: prediction.confidence,
      lower: prediction.lower,
      upper: prediction.upper,
    });
  }

  const headline =
    points.find((point) => point.horizonMinutes <= 20) ?? points[0] ?? null;
  if (!headline) return null;

  const headlinePrediction = model.predict({
    lineId: line.id,
    stopId: stop.id,
    at: new Date(headline.targetAt),
    capacity: line.capacityPerVehicle,
    headwayMinutes: line.headwayMinutes,
  });

  // History: hourly means of what actually happened over the last 26 hours.
  const buckets = new Map<number, { sum: number; count: number; headcount: number; capacity: number }>();
  for (const record of history) {
    const bucket = new Date(record.observedAt);
    bucket.setUTCMinutes(0, 0, 0);
    const key = bucket.getTime();
    const entry = buckets.get(key) ?? { sum: 0, count: 0, headcount: 0, capacity: record.capacity };
    entry.sum += record.ratio;
    entry.count += 1;
    entry.headcount += record.headcount;
    entry.capacity = record.capacity;
    buckets.set(key, entry);
  }

  const baseline: CrowdForecastPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, entry]) => {
      const ratio = entry.sum / Math.max(entry.count, 1);
      return {
        targetAt: new Date(key).toISOString(),
        horizonMinutes: -Math.round((now.getTime() - key) / 60000),
        ratio: round(ratio, 3),
        headcount: Math.round(entry.headcount / Math.max(entry.count, 1)),
        capacity: entry.capacity,
        level: crowdLevelFromRatio(ratio),
        confidence: 1,
        lower: round(ratio, 3),
        upper: round(ratio, 3),
      };
    });

  if (request.persist !== false) {
    await upsertForecasts(
      db,
      points.map((point) => ({
        lineId: line.id,
        stopId: stop.id,
        targetAt: point.targetAt,
        horizonMinutes: point.horizonMinutes,
        ratio: point.ratio,
        headcount: point.headcount,
        lowerRatio: point.lower,
        upperRatio: point.upper,
        confidence: point.confidence,
        modelVersion: config.version,
        factors: Object.fromEntries(
          headlinePrediction.factors.map((factor) => [factor.key, factor.contribution]),
        ),
      })),
    );
  }

  return {
    lineId: line.id,
    lineCode: line.code,
    lineName: line.name,
    stopId: stop.id,
    stopName: stop.name,
    capacity: line.capacityPerVehicle,
    generatedAt: now.toISOString(),
    modelVersion: config.version,
    accuracy: config.accuracy,
    sampleSize: baselines.find((cell) => cell.lineId === line.id && cell.stopId === stop.id)?.sampleSize ?? 0,
    headline,
    points,
    factors: headlinePrediction.factors,
    baseline,
  };
}

/** Short, human phrasing used in cards and alerts. */
export function describeLevel(level: CrowdLevel): string {
  return CROWD_LEVEL_META[level].label;
}
