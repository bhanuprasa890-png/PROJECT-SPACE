import fs from 'node:fs/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { env, describeDriver, type DatabaseDriver } from '../config/env';

const { Pool } = pg;

/**
 * Thin, driver-agnostic database interface.
 *
 * The rest of the server (repositories, services, routes) only ever talks to
 * `DatabaseClient`; it never imports `pg` or PGlite directly. Swapping the
 * embedded demo database for Supabase Postgres is therefore a configuration
 * change, not a code change.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
}

export interface DatabaseClient extends Queryable {
  kind: DatabaseDriver;
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Postgres (Supabase) driver                                                 */
/* -------------------------------------------------------------------------- */

class PostgresClient implements DatabaseClient {
  readonly kind: DatabaseDriver = 'supabase-postgres';
  private pool: pg.Pool;

  constructor(connectionString: string, ssl: boolean) {
    this.pool = new Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'transitpulse-ai',
    });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(sql, params as never[]);
    return result.rows as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Queryable = {
      query: async <R>(sql: string, params: unknown[] = []) =>
        (await client.query(sql, params as never[])).rows as R[],
      one: async <R>(sql: string, params: unknown[] = []) => {
        const res = await client.query(sql, params as never[]);
        return (res.rows[0] as R) ?? null;
      },
      exec: async (sql: string) => {
        await client.query(sql);
      },
    };
    try {
      await client.query('begin');
      const result = await fn(tx);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/* -------------------------------------------------------------------------- */
/* Embedded Postgres driver (zero-config demo mode)                           */
/* -------------------------------------------------------------------------- */

class EmbeddedPostgresClient implements DatabaseClient {
  readonly kind: DatabaseDriver = 'embedded-postgres';
  private db: PGlite;

  constructor(db: PGlite) {
    this.db = db;
  }

  static async create(dir: string): Promise<EmbeddedPostgresClient> {
    await fs.mkdir(dir, { recursive: true });
    // `idb://` prefix keeps the data directory on disk between boots.
    const db = await PGlite.create({ dataDir: dir });
    return new EmbeddedPostgresClient(db);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params as never[]);
    return result.rows;
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const wrapped: Queryable = {
        query: async <R>(sql: string, params: unknown[] = []) => {
          const res = await tx.query<R>(sql, params as never[]);
          return res.rows;
        },
        one: async <R>(sql: string, params: unknown[] = []) => {
          const res = await tx.query<R>(sql, params as never[]);
          return (res.rows[0] as R) ?? null;
        },
        exec: async (sql: string) => {
          await tx.exec(sql);
        },
      };
      return fn(wrapped);
    }) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                  */
/* -------------------------------------------------------------------------- */

let clientPromise: Promise<DatabaseClient> | null = null;

export function getDb(): Promise<DatabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      if (env.database.url) {
        const client = new PostgresClient(env.database.url, env.database.ssl);
        // Fail fast with a clear message instead of an opaque pool timeout.
        await client.query('select 1');
        return client;
      }
      return EmbeddedPostgresClient.create(env.database.embeddedDir);
    })();
  }
  return clientPromise;
}

export async function closeDb(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = null;
}

export function driverName(): DatabaseDriver {
  return describeDriver();
}
