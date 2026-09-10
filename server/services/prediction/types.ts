import type { DayType, TransitMode } from '../../../shared/types';

/**
 * TransitPulse prediction layer — internal contracts
 * ==================================================
 *
 * The pipeline is deliberately split into small, swappable stages:
 *
 *   Input Data → Prediction Engine → Occupancy Prediction → Crowd Classification
 *                                                          → Route Optimization
 *
 * Stage 1 (`PredictionInput`) is assembled by the engine from Postgres only.
 * Stage 2 is any object that satisfies `OccupancyPredictor` — the shipped
 * `heuristic-ensemble` implementation, or an external machine-learning service
 * (see `predictors/external-model.ts`). Stages 3-5 never depend on *which*
 * predictor produced the numbers, so the model can be replaced without touching
 * classification, the API or the UI.
 *
 * SIMULATION: every signal here comes from the simulated demo dataset. No value
 * in this pipeline is a real-world measurement.
 */

/* -------------------------------------------------------------------------- */
/* Stage 1 — Input Data                                                       */
/* -------------------------------------------------------------------------- */

/** Route-level signal: which service, how often, how big. */
export interface RouteSignal {
  lineId: string;
  lineCode: string;
  lineName: string;
  mode: TransitMode;
  capacity: number;
  headwayMinutes: number;
}

/**
 * Historical signal for this line/stop/day-type/hour cell, learned from
 * `crowd_observations` (14 simulated days). `scope` records how specific the
 * history is: this exact stop, the line as a whole, or the built-in prior.
 */
export interface HistoricalSignal {
  avgRatio: number;
  p90Ratio: number;
  sampleSize: number;
  scope: 'stop' | 'line' | 'prior';
  /** The following hour, used to interpolate across the hour boundary. */
  nextAvgRatio: number;
  nextP90Ratio: number;
}

/** Current occupancy: the liveest reading for this service, if there is one. */
export interface LiveSignal {
  ratio: number;
  observedAt: string;
  ageMinutes: number;
  source: string;
}

/** Optional weather factor, from the simulated `weather_conditions` table. */
export interface WeatherSignal {
  condition: WeatherCondition;
  label: string;
  /** Multiplier applied to the demand estimate (1.0 = no effect). */
  factor: number;
  severity: 0 | 1 | 2 | 3;
  temperatureC: number | null;
  rainfallMm: number;
  city: string;
  observedAt: string;
  source: 'simulated';
}

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'light_rain'
  | 'heavy_rain'
  | 'storm'
  | 'heatwave';

export interface PredictionInput {
  /** Instant being predicted (ISO). */
  targetAt: string;
  timeZone: string;
  /** Day type in the agency timezone — one of the model's inputs. */
  dayType: DayType;
  /** Local hour of day (0–23) and its fractional progress. */
  hourOfDay: number;
  fractionOfHour: number;

  route: RouteSignal;
  stopId: string | null;

  historical: HistoricalSignal;
  live: LiveSignal | null;
  weather: WeatherSignal | null;

  /** Occupancy already on board when the vehicle reaches the boarding stop. */
  upstreamRatio: number;
  /** Extra demand pressure (0–0.09) from active crowding notices. */
  alertPressure: number;
}

/* -------------------------------------------------------------------------- */
/* Stage 2 — Prediction Engine                                                */
/* -------------------------------------------------------------------------- */

export type PredictorKind = 'heuristic-ensemble' | 'external-model';

/** One signed contribution, expressed in occupancy-ratio points. */
export interface FactorContribution {
  key: string;
  label: string;
  contribution: number;
  detail: string;
}

/** The model's raw output, before classification and presentation. */
export interface PredictionCore {
  ratio: number;
  lowerRatio: number;
  upperRatio: number;
  confidence: number;
  /** Ratio the predictor would report with only historical demand applied. */
  baselineRatio: number;
  factors: FactorContribution[];
  note?: string;
}

/**
 * The swap point. A real machine-learning model only has to implement this
 * interface and be registered in `createPredictor()`; nothing downstream
 * changes.
 */
export interface OccupancyPredictor {
  readonly id: string;
  readonly kind: PredictorKind;
  readonly version: string;
  /** Human-readable note about availability, surfaced in the UI. */
  readonly note?: string;
  predict(input: PredictionInput): Promise<PredictionCore>;
}
