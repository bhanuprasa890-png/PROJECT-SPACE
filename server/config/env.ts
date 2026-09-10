import 'dotenv/config';
import path from 'node:path';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const databaseUrl = process.env.DATABASE_URL?.trim() || null;

/**
 * When `DATABASE_URL` is present TransitPulse talks to a real Postgres instance
 * (this is how you point the app at Supabase). Without it the app falls back to
 * an embedded Postgres so the demo boots with zero credentials — same SQL, same
 * schema, same seed data.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8787),

  database: {
    url: databaseUrl,
    ssl: bool(process.env.DB_SSL, Boolean(databaseUrl && !databaseUrl.includes('localhost'))),
    embeddedDir: process.env.PGLITE_DIR ?? path.resolve(process.cwd(), '.data/transitpulse'),
    autoMigrate: bool(process.env.DB_AUTO_MIGRATE, true),
    /** `DB_RESET=true` re-applies the demo seed on every boot. */
    reset: bool(process.env.DB_RESET, false),
    migrationsDir: path.resolve(process.cwd(), 'supabase/migrations'),
    seedDir: path.resolve(process.cwd(), 'supabase/seed'),
  },

  defaultProfileId: process.env.DEFAULT_PROFILE_ID ?? 'profile-ava',

  /**
   * Prediction layer configuration.
   *
   * The prototype ships a heuristic ensemble. Point `PREDICTION_MODEL_URL` at a
   * real machine-learning service that implements the `OccupancyPredictor`
   * contract (see `server/services/prediction/predictors/external-model.ts`) to
   * replace it — the rest of the pipeline is unchanged.
   */
  prediction: {
    modelUrl: process.env.PREDICTION_MODEL_URL?.trim() || null,
    modelApiKey: process.env.PREDICTION_MODEL_API_KEY?.trim() || null,
    modelTimeoutMs: Number(process.env.PREDICTION_MODEL_TIMEOUT_MS ?? 1200),
    /** Simulated weather factor is used unless the weather table is empty. */
    weatherEnabled: bool(process.env.PREDICTION_WEATHER, true),
  },

  /** Bumped whenever the crowd model's assumptions change. */
  modelVersion: 'transitpulse-crowd-v3',
  appVersion: '0.1.0',
} as const;

export type DatabaseDriver = 'supabase-postgres' | 'embedded-postgres';

export function describeDriver(): DatabaseDriver {
  return env.database.url ? 'supabase-postgres' : 'embedded-postgres';
}
