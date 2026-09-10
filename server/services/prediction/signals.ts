import { clamp, dayTypeFor, fractionalHour } from '../../lib/time';
import type { BaselineCell, CrowdRecord } from '../../repositories/crowd.repo';
import type { TransitMode } from '../../../shared/types';
import type { HistoricalSignal, LiveSignal, PredictionInput, RouteSignal, WeatherSignal } from './types';

/**
 * Stage 1 helper — signal index
 * =============================
 *
 * Turns raw database rows into the signals the predictor consumes:
 *
 *   · historical occupancy (mean + 90th percentile per line/stop/day/hour)
 *   · current occupancy (most recent simulated reading, with its age)
 *
 * Kept deliberately dumb and in-memory: the planner scores dozens of
 * itineraries per search, so the engine loads these once per request.
 */

/**
 * Prior demand curve, used only when a cell has no history at all (a brand-new
 * service). Learned data always wins.
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

export function priorRatio(hour: number, mode: TransitMode, dayType: string): number {
  const weekend = dayType !== 'weekday';
  const raw = PRIOR_CURVE[hour] ?? 0.4;
  const adjusted = weekend ? 0.55 + raw * 0.45 : raw;
  return clamp(MODE_BASE[mode] * adjusted, 0.08, 1.1);
}

type Cell = { avg: number; p90: number; sampleSize: number; scope: 'stop' | 'line' };

const cellKey = (lineId: string, stopId: string | null, dayType: string, hour: number): string =>
  `${lineId}|${stopId ?? '*'}|${dayType}|${hour}`;

export class SignalIndex {
  private readonly byStop = new Map<string, Cell>();
  private readonly byLine = new Map<string, Cell>();
  private readonly liveByCell = new Map<string, CrowdRecord[]>();

  constructor(cells: BaselineCell[], readings: CrowdRecord[] = []) {
    for (const cell of cells) {
      const target = cell.stopId ? this.byStop : this.byLine;
      target.set(cellKey(cell.lineId, cell.stopId, cell.dayType, cell.hourOfDay), {
        avg: cell.avgRatio,
        p90: cell.p90Ratio,
        sampleSize: cell.sampleSize,
        scope: cell.stopId ? 'stop' : 'line',
      });
    }

    for (const reading of readings) {
      const key = `${reading.lineId}|${reading.stopId}`;
      const bucket = this.liveByCell.get(key);
      if (bucket) bucket.push(reading);
      else this.liveByCell.set(key, [reading]);
    }
    for (const bucket of this.liveByCell.values()) {
      bucket.sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
    }
  }

  /** Mean/p90 for a cell, falling back to the line-wide cell, then the prior. */
  historical(
    lineId: string,
    stopId: string | null,
    dayType: string,
    hour: number,
    mode: TransitMode,
  ): HistoricalSignal {
    const hourNorm = ((hour % 24) + 24) % 24;
    const nextHour = ((hour + 1) % 24 + 24) % 24;

    const resolve = (h: number): Cell | null => {
      if (stopId) {
        const stopCell = this.byStop.get(cellKey(lineId, stopId, dayType, h));
        if (stopCell) return stopCell;
      }
      return this.byLine.get(cellKey(lineId, null, dayType, h)) ?? null;
    };

    const current = resolve(hourNorm);
    const next = resolve(nextHour);
    const prior = priorRatio(hourNorm, mode, dayType);

    const avg = current?.avg ?? prior;
    const p90 = current?.p90 ?? avg * 1.12;
    const nextAvg = next?.avg ?? avg;
    const nextP90 = next?.p90 ?? p90;

    return {
      avgRatio: avg,
      p90Ratio: p90,
      sampleSize: current?.sampleSize ?? 0,
      scope: current?.scope ?? (stopId && this.byLine.has(cellKey(lineId, null, dayType, hourNorm)) ? 'line' : 'prior'),
      nextAvgRatio: nextAvg,
      nextP90Ratio: nextP90,
    };
  }

  /**
   * Most recent live reading for a line (at this stop when known). Returns null
   * when the newest sample is older than `maxAgeMinutes`.
   */
  live(
    lineId: string,
    stopId: string | null,
    at: Date,
    maxAgeMinutes = 120,
  ): LiveSignal | null {
    const candidates: CrowdRecord[] = [];
    if (stopId) {
      candidates.push(...(this.liveByCell.get(`${lineId}|${stopId}`) ?? []));
    } else {
      for (const [key, bucket] of this.liveByCell) {
        if (key.startsWith(`${lineId}|`)) candidates.push(...bucket);
      }
    }
    if (!candidates.length) return null;

    const newest = candidates.reduce((best, record) =>
      new Date(record.observedAt).getTime() > new Date(best.observedAt).getTime() ? record : best,
    );
    const ageMinutes = Math.max(
      0,
      (at.getTime() - new Date(newest.observedAt).getTime()) / 60000,
    );
    if (ageMinutes > maxAgeMinutes) return null;

    return {
      ratio: newest.ratio,
      observedAt: newest.observedAt,
      ageMinutes: Math.round(ageMinutes * 10) / 10,
      source: newest.source,
    };
  }

  get readingCount(): number {
    let total = 0;
    for (const bucket of this.liveByCell.values()) total += bucket.length;
    return total;
  }
}


/* -------------------------------------------------------------------------- */
/* Input assembly (Stage 1 → Stage 2 seam)                                    */
/* -------------------------------------------------------------------------- */

export interface BuildInputArgs {
  route: RouteSignal;
  stopId: string | null;
  at: Date;
  timeZone: string;
  index: SignalIndex;
  weather: WeatherSignal | null;
  upstreamRatio?: number;
  alertPressure?: number;
}

/**
 * Assembles the single `PredictionInput` object handed to a predictor. Both the
 * API engine and the planner's in-memory facade use this, so a prediction is
 * identical wherever it is requested from.
 */
export function buildPredictionInput(args: BuildInputArgs): PredictionInput {
  const { route, stopId, at, timeZone, index } = args;
  const dayType = dayTypeFor(at, timeZone);
  const exactHour = fractionalHour(at, timeZone);
  const hourOfDay = Math.floor(exactHour) % 24;

  return {
    targetAt: at.toISOString(),
    timeZone,
    dayType,
    hourOfDay,
    fractionOfHour: exactHour - Math.floor(exactHour),
    route,
    stopId,
    historical: index.historical(route.lineId, stopId, dayType, hourOfDay, route.mode),
    live: index.live(route.lineId, stopId, at),
    weather: args.weather,
    upstreamRatio: args.upstreamRatio ?? 0,
    alertPressure: args.alertPressure ?? 0,
  };
}
