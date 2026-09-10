import type { Queryable } from '../db/client';

/**
 * Model/planner configuration repository.
 *
 * Scoring weights, forecast horizons and service targets live in the database
 * (`model_config`) so they can be tuned without shipping a new build — and so
 * the UI never hardcodes operational constants.
 */

export interface PlannerWeights {
  time: number;
  crowd: number;
  transfer: number;
  walk: number;
  co2PerKmSavedKg: number;
  defaultFare: number;
  maxOptions: number;
}

export interface CrowdModelConfig {
  version: string;
  horizonMinutes: number;
  stepMinutes: number;
  confidenceFloor: number;
  baselineWindowDays: number;
  /** Rolling backtest accuracy reported on the Route Details screen. */
  accuracy: number;
  features: { key: string; label: string; weight: number }[];
}

export interface ServiceTargets {
  onTimeTargetPct: number;
  crowdingThresholdRatio: number;
  responseSlaMinutes: number;
}

export const PLANNER_WEIGHT_DEFAULTS: PlannerWeights = {
  time: 1,
  crowd: 1.35,
  transfer: 4.5,
  walk: 1.6,
  co2PerKmSavedKg: 0.121,
  defaultFare: 2.4,
  maxOptions: 4,
};

export const MODEL_DEFAULTS: CrowdModelConfig = {
  version: 'transitpulse-crowd-v3',
  horizonMinutes: 120,
  stepMinutes: 10,
  confidenceFloor: 0.58,
  baselineWindowDays: 14,
  accuracy: 0.91,
  features: [],
};

export const TARGET_DEFAULTS: ServiceTargets = {
  onTimeTargetPct: 92,
  crowdingThresholdRatio: 0.85,
  responseSlaMinutes: 12,
};

export async function getConfig<T>(db: Queryable, key: string, fallback: T): Promise<T> {
  const row = await db.one<{ value: unknown }>(
    'select value from model_config where key = $1',
    [key],
  );
  if (!row) return fallback;

  const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  return { ...fallback, ...(value as object) } as T;
}

export async function getAllConfig(db: Queryable): Promise<Record<string, unknown>> {
  const rows = await db.query<{ key: string; value: unknown; description: string | null }>(
    'select key, value, description from model_config order by key',
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      {
        value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
        description: row.description,
      },
    ]),
  );
}

export async function setConfig(db: Queryable, key: string, value: unknown): Promise<void> {
  await db.query(
    `insert into model_config (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
