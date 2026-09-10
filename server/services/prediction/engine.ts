import { env } from '../../config/env';
import { clamp } from '../../lib/time';
import type { Queryable } from '../../db/client';
import type { TransitMode } from '../../../shared/types';
import type {
  OccupancyPredictionResult,
  PredictionEngineDescriptor,
  PredictionEngineReport,
  PredictionFactorReport,
  PredictionPipelineStage,
  WeatherSnapshot,
} from '../../../shared/types';
import { listBaselines, listLatestReadings } from '../../repositories/crowd.repo';
import { MODEL_DEFAULTS, getConfig, type CrowdModelConfig } from '../../repositories/config.repo';
import { getAgency, getLineByIdOrCode, getStop } from '../../repositories/network.repo';
import { CROWD_CLASSES, classifyOccupancyPercentage } from './classification';
import { ExternalModelPredictor } from './predictors/external-model';
import { heuristicPredictor } from './predictors/heuristic-ensemble';
import { buildPredictionInput, SignalIndex } from './signals';
import {
  listWeatherSlots,
  nearestWeather,
  synthesiseWeather,
  type WeatherSlot,
} from './weather';

import type {
  OccupancyPredictor,
  RouteSignal,
  WeatherCondition,
  WeatherSignal,
} from './types';

/**
 * TransitPulse prediction engine
 * ==============================
 *
 * Stage 1 **Input Data** — historical occupancy, current occupancy, route
 * attributes, day type and time of day come from Postgres; weather comes from
 * the simulated `weather_conditions` table.
 *
 * Stage 2 **Prediction Engine** — an `OccupancyPredictor` (heuristic ensemble by
 * default, external model when configured) turns those inputs into a ratio,
 * an interval, a confidence and per-factor contributions.
 *
 * Stage 3 **Occupancy Prediction** — the result is packaged as a percentage,
 * headcount against capacity, and a confidence range.
 *
 * Stage 4 **Crowd Classification** — the percentage is bucketed into
 * Low / Moderate / High with the thresholds shared with Postgres.
 *
 * Stage 5 **Route Optimization** — the planner consumes this same engine, so
 * the journeys the commuter sees are scored with exactly these predictions.
 *
 * SIMULATION: all inputs are synthetic demo data. See `SIMULATION_DISCLAIMER`.
 */

export const SIMULATION_DISCLAIMER =
  'Simulated prototype — occupancy, telemetry and weather are synthetic demo data, not real-world measurements. No production accuracy is claimed.';

export interface PredictionRequest {
  /** Line id (`LN-B12`) or route number (`21G`). */
  lineIdOrCode: string;
  stopId?: string | null;
  at?: Date;
  capacity?: number;
  upstreamRatio?: number;
  /** `auto` uses the simulated weather table, `none` disables it. */
  weather?: WeatherCondition | 'auto' | 'none';
}

export interface PredictionEngineOptions {
  predictor?: OccupancyPredictor;
  timeZone?: string;
  /** Hours of simulated weather to preload (default 12). */
  weatherHours?: number;
}

const INPUT_CATALOGUE: { key: string; label: string; source: string; detail: string }[] = [
  {
    key: 'historical',
    label: 'Historical occupancy',
    source: 'crowd_observations → v_line_hourly_profile',
    detail: '14 simulated days, aggregated to a line/stop/day-type/hour mean and 90th percentile.',
  },
  {
    key: 'timeOfDay',
    label: 'Time of day',
    source: 'agency timezone (Asia/Kolkata)',
    detail: 'Local hour + fraction, interpolated between the current and next hour cell.',
  },
  {
    key: 'route',
    label: 'Route',
    source: 'lines · vehicles · service_patterns',
    detail: 'Mode, vehicle capacity, service frequency and the route’s stop sequence.',
  },
  {
    key: 'current',
    label: 'Current occupancy',
    source: 'crowd_observations (latest reading)',
    detail: 'Most recent simulated on-board count, weighted by how recently it was observed.',
  },
  {
    key: 'dayType',
    label: 'Day type',
    source: 'crowd_observations.day_type',
    detail: 'Weekday / Saturday / Sunday history, evaluated in the agency timezone.',
  },
  {
    key: 'weather',
    label: 'Weather (optional)',
    source: 'weather_conditions (simulated)',
    detail: 'Transparent demand multiplier for rain, storms and heatwaves; can be disabled.',
  },
  {
    key: 'operations',
    label: 'Operational pressure',
    source: 'alerts · upstream load',
    detail: 'Active crowding notices and riders already on board further up the line.',
  },
];

const STAGES: PredictionPipelineStage[] = [
  {
    key: 'input',
    title: '1 · Input Data',
    summary: 'Historical, live, calendar, route and weather signals',
    detail:
      'Everything the model consumes is read from Postgres (plus the simulated weather table) and assembled into one `PredictionInput` object.',
    code: 'server/services/prediction/signals.ts · weather.ts',
  },
  {
    key: 'engine',
    title: '2 · Prediction Engine',
    summary: 'Swappable predictor behind one interface',
    detail:
      'The engine calls an `OccupancyPredictor`. The shipped implementation is a transparent heuristic ensemble; a real ML service can be plugged in through PREDICTION_MODEL_URL.',
    code: 'server/services/prediction/predictors/',
  },
  {
    key: 'occupancy',
    title: '3 · Occupancy Prediction',
    summary: 'Percentage, headcount, interval and confidence',
    detail:
      'The raw ratio is packaged as predicted occupancy %, riders vs capacity, a confidence range and a confidence percentage that decays with the forecast horizon.',
    code: 'server/services/prediction/engine.ts',
  },
  {
    key: 'classification',
    title: '4 · Crowd Classification',
    summary: 'Low · Moderate · High',
    detail:
      'Percentage → band using the shared thresholds (<60 Low, 60–85 Moderate, >85 High) mirrored in Postgres by fn_crowd_level().',
    code: 'server/services/prediction/classification.ts · shared/crowd.ts',
  },
  {
    key: 'optimization',
    title: '5 · Route Optimization',
    summary: 'Predictions drive the recommendation',
    detail:
      'The planner scores every itinerary as travel + waiting + crowd penalty, so the route the commuter is offered depends on these predictions.',
    code: 'server/services/planner.ts',
  },
];

export class PredictionEngine {
  private readonly weatherSlots: WeatherSlot[];
  private readonly pressureByLine = new Map<string, number>();

  private constructor(
    private readonly db: Queryable,
    private readonly index: SignalIndex,
    private readonly predictor: OccupancyPredictor,
    private readonly config: CrowdModelConfig,
    private readonly timeZone: string,
    weatherSlots: WeatherSlot[],
    pressureByLine?: Map<string, number>,
  ) {
    this.weatherSlots = weatherSlots;
    if (pressureByLine) {
      for (const [lineId, pressure] of pressureByLine) this.pressureByLine.set(lineId, pressure);
    }
  }

  /**
   * Loads every input the engine needs for one request cycle: historical
   * baselines, the latest live readings, crowding pressure and simulated
   * weather slots.
   */
  static async load(
    db: Queryable,
    options: PredictionEngineOptions = {},
  ): Promise<PredictionEngine> {
    const [config, agency, cells, readings, weatherSlots] = await Promise.all([
      getConfig<CrowdModelConfig>(db, 'crowd_model', MODEL_DEFAULTS),
      getAgency(db),
      listBaselines(db),
      listLatestReadings(db, { limit: 800 }),
      listWeatherSlots(db, { hours: options.weatherHours ?? 12 }),
    ]);

    const timeZone = options.timeZone ?? agency?.timezone ?? 'UTC';
    const index = new SignalIndex(cells, readings);

    return new PredictionEngine(db, index, options.predictor ?? createPredictor(), config, timeZone, weatherSlots);
  }

  /** Route signal for a line, so callers can assemble inputs themselves. */
  static routeSignal(line: {
    id: string;
    code: string;
    name: string;
    mode: TransitMode;
    capacityPerVehicle: number;
    headwayMinutes: number;
  }, capacity?: number): RouteSignal {
    return {
      lineId: line.id,
      lineCode: line.code,
      lineName: line.name,
      mode: line.mode,
      capacity: capacity ?? line.capacityPerVehicle,
      headwayMinutes: line.headwayMinutes,
    };
  }

  /* ------------------------------------------------------------------ info */

  get descriptor(): PredictionEngineDescriptor {
    return describeEngine({
      predictor: this.predictor,
      config: this.config,
      weatherEnabled: this.weatherSlots.length > 0,
    });
  }

  get weatherSource(): 'weather_conditions (simulated)' | 'disabled' {
    return this.weatherSlots.length ? 'weather_conditions (simulated)' : 'disabled';
  }

  /** Simulated weather now + the next slots, for the UI strip. */
  weatherSnapshot(): { current: WeatherSnapshot | null; slots: WeatherSnapshot[] } {
    const now = Date.now();
    const slots = this.weatherSlots.map(toSnapshot);
    const current =
      [...slots].reverse().find((slot) => new Date(slot.at).getTime() <= now) ?? slots[0] ?? null;
    return { current, slots };
  }

  report(): PredictionEngineReport {
    return {
      engine: this.descriptor,
      classes: CROWD_CLASSES.map((entry) => ({
        level: entry.level,
        label: entry.label,
        description: entry.description,
        range: `${entry.fromPercentage}–${entry.toPercentage ?? '∞'}%`,
        examplePercentage: entry.level === 'low' ? 48 : entry.level === 'moderate' ? 72 : 91,
        rule:
          entry.toPercentage === null
            ? `above ${entry.fromPercentage}%`
            : `below ${entry.toPercentage}%`,
      })),
      inputs: INPUT_CATALOGUE,
      stages: STAGES,
      weather: { source: this.weatherSource, ...this.weatherSnapshot() },
      routeOptimization: {
        consumer: 'server/services/planner.ts',
        detail:
          'Planner itineraries are scored with the predicted occupancy of every leg, so the recommendation changes when the forecast does.',
        scoreFormula: 'route score = travel time + waiting time + crowd penalty',
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /* --------------------------------------------------------------- predict */

  async predict(request: PredictionRequest): Promise<OccupancyPredictionResult | null> {
    const line = await getLineByIdOrCode(this.db, request.lineIdOrCode);
    if (!line) return null;

    const stop = request.stopId ? await getStop(this.db, request.stopId) : null;
    const at = request.at ?? new Date();
    const capacity = request.capacity ?? line.capacityPerVehicle;

    const weather = this.resolveWeather(request.weather ?? 'auto', at);
    const alertPressure = this.pressureByLine.get(line.id) ?? 0;

    const input = buildPredictionInput({
      route: {
        lineId: line.id,
        lineCode: line.code,
        lineName: line.name,
        mode: line.mode,
        capacity,
        headwayMinutes: line.headwayMinutes,
      },
      stopId: stop?.id ?? null,
      at,
      timeZone: this.timeZone,
      index: this.index,
      weather,
      upstreamRatio: request.upstreamRatio ?? 0,
      alertPressure,
    });
    const { historical, live, dayType, hourOfDay: hour } = input;

    const core = await this.predictor.predict(input);
    const percentage = clamp(Math.round(core.ratio * 1000) / 10, 0, 200);
    const classification = classifyOccupancyPercentage(percentage);

    const factors: PredictionFactorReport[] = core.factors.map((factor) => {
      const contributionPct = Math.round(factor.contribution * 1000) / 10;
      return {
        key: factor.key,
        label: factor.label,
        contributionPct,
        contributionRatio: factor.contribution,
        detail: factor.detail,
        direction: contributionPct > 0.05 ? 'raises' : contributionPct < -0.05 ? 'lowers' : 'neutral',
      };
    });

    return {
      route: {
        id: line.id,
        code: line.code,
        name: line.name,
        mode: line.mode,
        capacity,
        headwayMinutes: line.headwayMinutes,
      },
      stop: stop ? { id: stop.id, code: stop.code, name: stop.name } : null,
      targetAt: input.targetAt,
      timeZone: this.timeZone,
      dayType,
      hourOfDay: hour,

      predictedOccupancyPercentage: Math.round(percentage * 10) / 10,
      predictedRatio: core.ratio,
      headcount: Math.max(1, Math.round(core.ratio * capacity)),
      capacity,
      baselineOccupancyPercentage: Math.round(core.baselineRatio * 1000) / 10,
      interval: {
        lowerPercentage: Math.round(core.lowerRatio * 1000) / 10,
        upperPercentage: Math.round(core.upperRatio * 1000) / 10,
      },
      crowd: {
        level: classification.level,
        label: classification.label,
        description: classification.description,
        range: `${classification.fromPercentage}–${classification.toPercentage ?? '∞'}%`,
      },
      confidencePercentage: Math.round(core.confidence * 1000) / 10,
      factors,
      inputsUsed: {
        historicalSamples: historical.sampleSize,
        historicalScope: historical.scope,
        currentOccupancyPercentage: live ? Math.round(live.ratio * 1000) / 10 : null,
        currentOccupancyAgeMinutes: live ? live.ageMinutes : null,
        upstreamOccupancyPercentage: Math.round((request.upstreamRatio ?? 0) * 1000) / 10,
        alertPressurePct: Math.round(alertPressure * 1000) / 10,
        weather: weather ? toSnapshot(weather) : null,
      },
      engine: this.descriptor,
      disclaimer: SIMULATION_DISCLAIMER,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Predictions for several instants — used to draw an engine-driven curve. */
  async predictSeries(
    request: PredictionRequest & { minutes?: number; stepMinutes?: number },
  ): Promise<OccupancyPredictionResult[]> {
    const minutes = request.minutes ?? 120;
    const step = request.stepMinutes ?? 15;
    const base = (request.at ?? new Date()).getTime();
    const results: OccupancyPredictionResult[] = [];

    for (let offset = 0; offset <= minutes; offset += step) {
      const result = await this.predict({ ...request, at: new Date(base + offset * 60000) });
      if (result) results.push(result);
    }
    return results;
  }

  private resolveWeather(
    scenario: WeatherCondition | 'auto' | 'none',
    at: Date,
  ): WeatherSignal | null {
    if (scenario === 'none') return null;
    if (scenario !== 'auto') {
      // Scenario override: models "what if the weather were …" without the table.
      return synthesiseWeather(scenario, at, this.weatherSlots[0]?.city);
    }
    return nearestWeather(this.weatherSlots, at);
  }
}

function toSnapshot(signal: WeatherSignal): WeatherSnapshot {
  return {
    at: signal.observedAt,
    city: signal.city,
    condition: signal.condition,
    label: signal.label,
    factor: signal.factor,
    severity: signal.severity,
    temperatureC: signal.temperatureC,
    rainfallMm: signal.rainfallMm,
    source: 'simulated',
  };
}

/**
 * Pure descriptor builder, shared by the DB-backed engine and the planner's
 * in-memory facade so both report the same model identity.
 */
export function describeEngine(args: {
  predictor: OccupancyPredictor;
  config: CrowdModelConfig;
  weatherEnabled: boolean;
}): PredictionEngineDescriptor {
  const fallbackNote =
    args.predictor instanceof ExternalModelPredictor ? args.predictor.lastError : null;

  return {
    id: args.predictor.id,
    kind: args.predictor.kind,
    version: `${args.config.version} + ${args.predictor.id} ${args.predictor.version}`,
    simulated: true,
    note: args.predictor.note ?? 'Prediction engine',
    inputs: INPUT_CATALOGUE.map((entry) => entry.label),
    weatherSource: args.weatherEnabled ? 'weather_conditions (simulated)' : 'disabled',
    fallbackNote,
    disclaimer: SIMULATION_DISCLAIMER,
  };
}

/**
 * Predictor selection. Today this returns the heuristic ensemble; set
 * `PREDICTION_MODEL_URL` to route predictions through a real ML service that
 * implements the `OccupancyPredictor` contract.
 */
export function createPredictor(): OccupancyPredictor {
  if (env.prediction.modelUrl) {
    return new ExternalModelPredictor({
      url: env.prediction.modelUrl,
      apiKey: env.prediction.modelApiKey ?? undefined,
      timeoutMs: env.prediction.modelTimeoutMs,
      fallback: heuristicPredictor,
    });
  }
  return heuristicPredictor;
}

export const PREDICTION_STAGES = STAGES;
export const PREDICTION_INPUTS = INPUT_CATALOGUE;
