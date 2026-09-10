import { crowdLevelFromRatio, CROWD_LEVEL_META } from '../../shared/crowd';
import type {
  CrowdForecastPoint,
  CrowdLevel,
  ForecastFactor,
  ForecastSeries,
  PredictionEngineDescriptor,
  TransitMode,
} from '../../shared/types';
import type { Queryable } from '../db/client';
import { MODEL_DEFAULTS, getConfig, type CrowdModelConfig } from '../repositories/config.repo';
import {
  listBaselines,
  listLatestReadings,
  listPersistedForecasts,
  listRecentObservations,
  upsertForecasts,
} from '../repositories/crowd.repo';
import { alertsForLine } from '../repositories/alerts.repo';
import { getAgency, getLineByIdOrCode, getStop } from '../repositories/network.repo';
import { clamp, round } from '../lib/time';
import {
  buildPredictionInput,
  createPredictor,
  describeEngine,
  listWeatherSlots,
  nearestWeather,
  SignalIndex,
  type OccupancyPredictor,
  type WeatherSignal,
  type WeatherSlot,
} from './prediction';

/**
 * TransitPulse crowd model — planner-facing facade
 * ===============================================
 *
 * The maths now lives in the prediction layer:
 *
 *   server/services/prediction/ — Input Data → Prediction Engine →
 *   Occupancy Prediction → Crowd Classification → Route Optimization
 *
 * This facade keeps the planner's synchronous, in-memory hot path: it loads
 * every signal once per request (historical cells, live readings, simulated
 * weather) and then scores dozens of legs without touching the database again.
 * It reports the same `PredictionEngineDescriptor` as the API engine, so the
 * planner, the forecast chart and the Prediction Engine screen all describe the
 * same model.
 *
 * SIMULATION: every input is simulated demo data. No production accuracy claim.
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
  /** Which predictor produced this value. */
  engine: PredictionEngineDescriptor;
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
  /** Optional explicit weather signal; defaults to the preloaded slot. */
  weather?: WeatherSignal | null;
}

export class CrowdModel {
  private readonly timeZone: string;

  constructor(
    private readonly index: SignalIndex,
    private readonly config: CrowdModelConfig,
    private readonly predictor: OccupancyPredictor,
    private readonly weatherSlots: WeatherSlot[] = [],
    timeZone = 'UTC',
    private readonly pressureByLine: Map<string, number> = new Map(),
  ) {
    this.timeZone = timeZone;
  }

  static async load(db: Queryable, lineIds?: string[]): Promise<CrowdModel> {
    const [config, agency, cells, readings, weatherSlots] = await Promise.all([
      getConfig<CrowdModelConfig>(db, 'crowd_model', MODEL_DEFAULTS),
      getAgency(db),
      listBaselines(db, lineIds?.length ? { lineIds } : {}),
      listLatestReadings(db, { limit: 800 }),
      listWeatherSlots(db, { hours: 12 }),
    ]);

    return new CrowdModel(
      new SignalIndex(cells, readings),
      config,
      createPredictor(),
      weatherSlots,
      agency?.timezone ?? 'UTC',
    );
  }

  /** Model identity, shared with the prediction engine's own descriptor. */
  get engine(): PredictionEngineDescriptor {
    return describeEngine({
      predictor: this.predictor,
      config: this.config,
      weatherEnabled: this.weatherSlots.length > 0,
    });
  }

  get modelVersion(): string {
    return this.config.version;
  }

  /** Calibration on the simulated history — a prototype gauge, not an SLA. */
  get calibration(): number {
    return this.config.accuracy;
  }

  /**
   * Predicts occupancy for a line/stop at an instant in the future, returning
   * the value plus every contribution that produced it.
   */
  async predict(params: PredictParams): Promise<Prediction> {
    const timeZone = params.timeZone ?? this.timeZone;
    const weather =
      params.weather !== undefined
        ? params.weather
        : nearestWeather(this.weatherSlots, params.at);

    const input = buildPredictionInput({
      route: {
        lineId: params.lineId,
        lineCode: params.lineId,
        lineName: params.lineId,
        mode: params.mode ?? 'metro',
        capacity: params.capacity,
        headwayMinutes: params.headwayMinutes ?? 8,
      },
      stopId: params.stopId,
      at: params.at,
      timeZone,
      index: this.index,
      weather,
      upstreamRatio: params.upstreamRatio ?? 0,
      alertPressure: this.pressureByLine.get(params.lineId) ?? 0,
    });

    const core = await this.predictor.predict(input);

    return {
      ratio: round(core.ratio, 3),
      headcount: Math.max(1, Math.round(core.ratio * params.capacity)),
      level: crowdLevelFromRatio(core.ratio),
      confidence: round(core.confidence, 3),
      lower: round(clamp(core.lowerRatio, 0, 1.5), 3),
      upper: round(clamp(core.upperRatio, 0, 1.6), 3),
      factors: core.factors.map((factor) => ({
        key: factor.key,
        label: factor.label,
        contribution: round(factor.contribution, 4),
        detail: factor.detail,
      })),
      baselineRatio: round(core.baselineRatio, 3),
      engine: this.engine,
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

  const [baselines, alerts, history, readings, weatherSlots, agency] = await Promise.all([
    listBaselines(db, { lineIds: [line.id] }),
    alertsForLine(db, line.id),
    listRecentObservations(db, { lineId: line.id, stopId: stop.id, hours: 26, limit: 80 }),
    listLatestReadings(db, { limit: 400 }),
    listWeatherSlots(db, { hours: 8 }),
    getAgency(db),
  ]);

  const pressure = new Map<string, number>();
  const crowdingAlerts = alerts.filter((alert) => alert.category === 'crowding');
  if (crowdingAlerts.length) {
    pressure.set(line.id, Math.min(0.09, crowdingAlerts.length * 0.035));
  }

  const model = new CrowdModel(
    new SignalIndex(baselines, readings),
    config,
    createPredictor(),
    weatherSlots,
    agency?.timezone ?? 'UTC',
    pressure,
  );

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

    const prediction = await model.predict({
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

  const headlinePrediction = await model.predict({
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
    engine: model.engine,
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
