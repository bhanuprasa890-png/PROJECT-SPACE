import type { Queryable } from '../db/client';
import {
  DATASET_MINIMUMS,
  DATASET_TABLES,
  findDatasetTable,
  type DatasetTableDef,
} from '../../shared/dataset';
import type { DatasetColumn, DatasetTableSummary } from '../../shared/types';

/**
 * Dataset repository — reads the canonical demo dataset (routes, stops,
 * vehicles, occupancy predictions, route options, alerts, users).
 *
 * Table and column identifiers are validated against the whitelist in
 * `shared/dataset.ts` plus the live `information_schema`, so nothing user
 * supplied is ever interpolated into SQL.
 */

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

type KeyRow = { column_name: string };

/** `character varying(40)` style label instead of the raw `information_schema` type. */
function describeType(row: ColumnRow): string {
  if (row.data_type === 'character varying') {
    return row.character_maximum_length ? `varchar(${row.character_maximum_length})` : 'varchar';
  }
  if (row.data_type === 'numeric' && row.numeric_precision !== null) {
    return `numeric(${row.numeric_precision},${row.numeric_scale ?? 0})`;
  }
  if (row.data_type === 'timestamp with time zone') return 'timestamptz';
  if (row.data_type === 'double precision') return 'double precision';
  if (row.data_type === 'bigint') return 'bigint';
  return row.data_type;
}

export async function listDatasetColumns(db: Queryable, table: string): Promise<DatasetColumn[]> {
  const [columns, primaryKeys, foreignKeys] = await Promise.all([
    db.query<ColumnRow>(
      `select column_name, data_type, is_nullable, column_default, ordinal_position,
              character_maximum_length, numeric_precision, numeric_scale
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [table],
    ),
    db.query<KeyRow>(
      `select a.attname as column_name
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any (i.indkey)
       where n.nspname = 'public' and c.relname = $1 and i.indisprimary`,
      [table],
    ),
    db.query<{ column_name: string; foreign_table: string; foreign_column: string }>(
      `select kcu.column_name,
              ccu.table_name  as foreign_table,
              ccu.column_name as foreign_column
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
       where tc.constraint_type = 'FOREIGN KEY'
         and tc.table_schema = 'public' and tc.table_name = $1`,
      [table],
    ),
  ]);

  const pk = new Set(primaryKeys.map((row) => row.column_name));
  const fk = new Map(foreignKeys.map((row) => [row.column_name, `${row.foreign_table}.${row.foreign_column}`]));

  return columns.map((row) => ({
    name: row.column_name,
    dataType: describeType(row),
    nullable: row.is_nullable === 'YES',
    defaultValue: row.column_default,
    isPrimaryKey: pk.has(row.column_name),
    references: fk.get(row.column_name) ?? null,
  }));
}

async function summarise(db: Queryable, def: DatasetTableDef): Promise<DatasetTableSummary> {
  // `def.name` comes from the static registry — never from request input.
  const [count, columnCount] = await Promise.all([
    db.one<{ count: string }>(`select count(*)::text as count from ${def.name}`),
    db.one<{ count: string }>(
      `select count(*)::text as count from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [def.name],
    ),
  ]);

  return {
    name: def.name,
    label: def.label,
    kind: def.kind,
    requestedAs: def.requestedAs,
    description: def.description,
    rowCount: Number(count?.count ?? 0),
    columnCount: Number(columnCount?.count ?? 0),
    primaryKey: def.primaryKey,
    minimumRows: DATASET_MINIMUMS[def.requestedAs],
  };
}

export async function listDatasetTables(db: Queryable): Promise<DatasetTableSummary[]> {
  return Promise.all(DATASET_TABLES.map((def) => summarise(db, def)));
}

export interface DatasetQuery {
  table: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'asc' | 'desc';
}

type OrderToken = { column: string; direction: 'asc' | 'desc' };

/** Validates an ORDER BY clause against real columns; throws on anything else. */
function buildOrderBy(sql: string, columns: DatasetColumn[], fallback: string): OrderToken[] {
  const available = new Set(columns.map((column) => column.name));
  const source = (sql.trim() || fallback)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const tokens: OrderToken[] = source.map((part) => {
    const [column, rawDirection] = part.split(/\s+/);
    if (!available.has(column)) {
      throw new Error(`Unknown or unsortable column: ${column}`);
    }
    return { column, direction: rawDirection === 'desc' ? 'desc' : 'asc' };
  });

  if (!tokens.length) throw new Error('No sortable columns resolved');
  return tokens;
}

export async function fetchDatasetPage(db: Queryable, query: DatasetQuery) {
  const def = findDatasetTable(query.table);
  if (!def) throw new Error(`Unknown dataset table: ${query.table}`);

  const columns = await listDatasetColumns(db, def.name);
  const orderTokens = buildOrderBy(query.orderBy ?? '', columns, def.defaultOrder).map((token) => ({
    ...token,
    direction: query.direction ?? token.direction,
  }));

  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);

  const orderSql = orderTokens
    .map((token) => `${token.column} ${token.direction === 'desc' ? 'desc' : 'asc'}`)
    .join(', ');

  // Postgres returns NUMERIC/DECIMAL/BIGINT as strings to preserve precision;
  // for JSON consumers (the explorer, scripts, BI tools) numbers are friendlier.
  const numericColumns = new Set(
    columns
      .filter((column) => /^(numeric|decimal|bigint|smallint|integer|real|double precision)/.test(column.dataType))
      .map((column) => column.name),
  );

  const [table, rows, total] = await Promise.all([
    summarise(db, def),
    db.query<Record<string, unknown>>(
      `select * from ${def.name} order by ${orderSql} limit $1 offset $2`,
      [limit, offset],
    ),
    db.one<{ count: string }>(`select count(*)::text as count from ${def.name}`),
  ]);

  return {
    table,
    columns,
    rows: rows.map((row) => {
      const normalised: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value === null) normalised[key] = null;
        else if (value instanceof Date) normalised[key] = value.toISOString();
        else if (typeof value === 'number' || typeof value === 'boolean') normalised[key] = value;
        else if (typeof value === 'string') {
          normalised[key] =
            numericColumns.has(key) && value.trim() !== '' && !Number.isNaN(Number(value))
              ? Number(value)
              : value;
        } else normalised[key] = String(value);
      }
      return normalised;
    }),
    total: Number(total?.count ?? 0),
    limit,
    offset,
    orderBy: orderSql,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Rebuilds the canonical dataset from the network model and reports the new
 * row counts. Exposed to operators (and to `npm run db:refresh`).
 */
export async function refreshDataset(db: Queryable): Promise<Record<string, number>> {
  await db.query('select * from fn_refresh_demo_dataset()');
  const tables = await listDatasetTables(db);
  return Object.fromEntries(tables.map((table) => [table.name, table.rowCount]));
}
