import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DatabaseClient } from './client';
import { env } from '../config/env';

export interface MigrationReport {
  applied: string[];
  replayed: string[];
  skipped: string[];
  seedsApplied: string[];
  schemaVersion: string | null;
}

async function readSqlDir(dir: string): Promise<{ name: string; sql: string }[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => ({
      name,
      sql: await fs.readFile(path.join(dir, name), 'utf8'),
    })),
  );
}

function checksum(sql: string): string {
  return crypto.createHash('sha1').update(sql).digest('hex').slice(0, 16);
}

async function appliedVersions(db: DatabaseClient): Promise<Map<string, string | null>> {
  const rows = await db.query<{ version: string; checksum: string | null }>(
    'select version, checksum from schema_migrations',
  );
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

async function record(
  db: DatabaseClient,
  version: string,
  checksumValue: string,
): Promise<void> {
  await db.query(
    `insert into schema_migrations (version, checksum) values ($1, $2)
     on conflict (version) do update set checksum = excluded.checksum,
       applied_at = now()`,
    [version, checksumValue],
  );
}

/**
 * Applies every pending migration in `supabase/migrations`, then loads the demo
 * dataset from `supabase/seed` when the database is empty, when a seed has not
 * been recorded yet, or when `DB_RESET=true` forces a demo reload.
 *
 * The same runner is used for the embedded database and for a real Supabase
 * Postgres instance, so schema drift between demo and production is impossible.
 */
export async function runMigrations(
  db: DatabaseClient,
  options: { forceSeeds?: boolean } = {},
): Promise<MigrationReport> {
  const report: MigrationReport = {
    applied: [],
    replayed: [],
    skipped: [],
    seedsApplied: [],
    schemaVersion: null,
  };

  await db.exec(`
    create table if not exists schema_migrations (
      version     text primary key,
      applied_at  timestamptz not null default now(),
      checksum    text
    );
  `);

  const already = await appliedVersions(db);
  const migrations = await readSqlDir(env.database.migrationsDir);

  for (const migration of migrations) {
    const key = `migrations/${migration.name}`;
    const hash = checksum(migration.sql);
    const previous = already.get(key);

    if (previous === undefined) {
      await db.exec('begin');
      try {
        await db.exec(migration.sql);
        await record(db, key, hash);
        await db.exec('commit');
        report.applied.push(migration.name);
      } catch (error) {
        await db.exec('rollback');
        throw new Error(
          `Migration ${migration.name} failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
    } else if (previous !== hash) {
      // Development convenience: re-run edited migrations (they are written to
      // be idempotent) so iterating on schema does not require wiping data.
      await db.exec('begin');
      try {
        await db.exec(migration.sql);
        await record(db, key, hash);
        await db.exec('commit');
        report.replayed.push(migration.name);
      } catch (error) {
        await db.exec('rollback');
        throw new Error(
          `Migration replay ${migration.name} failed: ${(error as Error).message}`,
          { cause: error },
        );
      }
    } else {
      report.skipped.push(migration.name);
    }
  }

  const seeds = await readSqlDir(env.database.seedDir);
  const networkEmpty = await isEmpty(db);

  // Seeds form a set: the first file resets the demo data, the rest load it.
  // If any file is new, edited or the network is empty, the whole set is
  // re-applied so partial reloads can never duplicate telemetry rows.
  const pending = seeds.filter((seed) => {
    const key = `seed/${seed.name}`;
    const previous = already.get(key);
    return (
      options.forceSeeds ||
      env.database.reset ||
      previous === undefined ||
      previous !== checksum(seed.sql) ||
      networkEmpty
    );
  });

  if (pending.length) {
    for (const seed of seeds) {
      const key = `seed/${seed.name}`;
      await db.exec('begin');
      try {
        await db.exec(seed.sql);
        await record(db, key, checksum(seed.sql));
        await db.exec('commit');
        report.seedsApplied.push(seed.name);
      } catch (error) {
        await db.exec('rollback');
        throw new Error(`Seed ${seed.name} failed: ${(error as Error).message}`, { cause: error });
      }
    }
  }

  const version = await db.one<{ version: string }>(
    `select version from schema_migrations
     where version like 'migrations/%'
     order by version desc limit 1`,
  );
  report.schemaVersion = version?.version ?? null;
  return report;
}

async function isEmpty(db: DatabaseClient): Promise<boolean> {
  try {
    const row = await db.one<{ count: string }>('select count(*)::text as count from stops');
    return !row || row.count === '0';
  } catch {
    return true;
  }
}
