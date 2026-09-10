import { useMemo, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Database,
  KeyRound,
  Link2,
  RefreshCw,
  Rows3,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import type { DatasetColumn } from '@shared/types';
import { useDatasetRows, useDatasetTables, useHealth, useRefreshDataset } from '../hooks/useTransitData';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, PanelSkeleton, Skeleton } from '../components/ui/Skeleton';
import { StatTile } from '../components/ui/StatTile';
import { cn, formatNumber, formatTimeAgo } from '../lib/utils';

/**
 * Data Explorer.
 *
 * A window onto the canonical Postgres dataset that every other screen reads
 * through: routes, stops, vehicles, occupancy predictions, route options,
 * alerts and users. It exists to make the database layer inspectable — the
 * browser talks to the API only, and all data is DEMO / SIMULATED.
 */

const PAGE_SIZE = 12;

function formatCell(value: string | number | boolean | null, column?: DatasetColumn): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (column?.dataType === 'timestamptz') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return formatTimeAgo(value);
  }
  return String(value);
}

function ColumnChips({ columns }: { columns: DatasetColumn[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {columns.map((column) => (
        <span
          key={column.name}
          title={`${column.dataType}${column.nullable ? '' : ' · not null'}${
            column.references ? ` → ${column.references}` : ''
          }`}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 figure text-3xs',
            column.isPrimaryKey
              ? 'border-pulse-400/35 bg-pulse-400/10 text-pulse-200'
              : column.references
                ? 'border-sky-glow/25 bg-sky-glow/8 text-sky-glow'
                : 'border-white/10 bg-white/5 text-mist-400',
          )}
        >
          {column.isPrimaryKey && <KeyRound className="size-2.5" />}
          {column.references && <Link2 className="size-2.5" />}
          {column.name}
        </span>
      ))}
    </div>
  );
}

export function DataExplorerPage() {
  const tables = useDatasetTables();
  const health = useHealth();
  const refresh = useRefreshDataset();

  const [activeTable, setActiveTable] = useState<string>('routes');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' } | null>(null);

  const rows = useDatasetRows(activeTable, {
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    orderBy: sort ? `${sort.column} ${sort.direction}` : undefined,
  });

  const selected = useMemo(
    () => tables.data?.tables.find((table) => table.name === activeTable) ?? null,
    [tables.data?.tables, activeTable],
  );

  const columnIndex = useMemo(() => {
    const map = new Map<string, DatasetColumn>();
    for (const column of rows.data?.columns ?? []) map.set(column.name, column);
    return map;
  }, [rows.data?.columns]);

  const totalPages = rows.data ? Math.max(1, Math.ceil(rows.data.total / PAGE_SIZE)) : 1;

  const selectTable = (name: string): void => {
    setActiveTable(name);
    setPage(0);
    setSort(null);
  };

  if (tables.isError) {
    return (
      <ErrorState
        title="Dataset unavailable"
        message={(tables.error as Error)?.message}
        onRetry={() => void tables.refetch()}
      />
    );
  }

  const database = health.data?.database;
  const canonicalTables = (tables.data?.tables ?? []).filter((table) => table.kind === 'table');
  const publishedViews = (tables.data?.tables ?? []).filter((table) => table.kind === 'view');

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------- header */}
      <Card accent="sky">
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="info" icon={<Database className="size-3" />}>
                  Supabase Postgres
                </Badge>
                <Badge tone={database ? 'low' : 'info'} size="sm">
                  {database?.driver === 'supabase-postgres'
                    ? 'Connected to DATABASE_URL'
                    : 'Embedded Postgres (credentials-free demo)'}
                </Badge>
                <Badge tone="neutral" size="sm">
                  DEMO · simulated data
                </Badge>
              </div>
              <p className="max-w-2xl text-sm text-mist-300">
                Every screen in TransitPulse reads Postgres through the API — nothing is mocked in
                the browser. This is the published route-level dataset, projected from the same
                network, telemetry and model output the rest of the app runs on.
              </p>
              <p className="figure text-2xs text-mist-500">
                {database?.schemaVersion ?? 'schema version unknown'} · latency{' '}
                {database?.latencyMs ?? '—'} ms · {formatNumber(tables.data?.totals.rows ?? 0)} rows in{' '}
                {canonicalTables.length} tables + {publishedViews.length} published views
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('size-3.5', refresh.isPending && 'animate-spin')} />}
              loading={refresh.isPending}
              onClick={() => refresh.mutate()}
            >
              Rebuild dataset
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Tables"
              value={canonicalTables.length}
              hint={`${formatNumber(canonicalTables.reduce((sum, t) => sum + t.rowCount, 0))} canonical rows`}
              icon={Table2}
              accent="sky"
            />
            <StatTile
              label="Published views"
              value={publishedViews.length}
              hint="Requested table names (stops, vehicles, alerts, users)"
              icon={Columns3}
            />
            <StatTile
              label="Selected table"
              value={selected ? formatNumber(selected.rowCount) : '—'}
              hint={selected ? `${selected.name} · ${selected.columnCount} columns` : ''}
              icon={Rows3}
              accent="pulse"
            />
            <StatTile
              label="Row level security"
              value="On"
              hint="Public read-only · writes via the API service role"
              icon={ShieldCheck}
              accent="none"
            />
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------- table picker */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader
            title="Dataset"
            subtitle="Canonical tables"
            icon={<Database className="size-4 text-sky-glow" />}
          />
          <CardBody className="space-y-4 pt-3">
            {tables.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 7 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              <>
                <ul className="space-y-1">
                  {canonicalTables.map((table) => (
                    <li key={table.name}>
                      <button
                        type="button"
                        onClick={() => selectTable(table.name)}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                          table.name === activeTable
                            ? 'border-pulse-400/40 bg-pulse-400/10'
                            : 'border-white/8 bg-white/2 hover:border-white/16 hover:bg-white/6',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate figure text-xs text-mist-100">
                            {table.name}
                          </span>
                          <span className="block truncate text-3xs text-mist-500">
                            {table.label}
                            {table.requestedAs !== table.name ? ` · requested as ${table.requestedAs}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 figure text-2xs text-mist-300">
                          {table.rowCount}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="space-y-2">
                  <p className="text-3xs tracking-[0.14em] text-mist-500 uppercase">
                    Published names
                  </p>
                  <ul className="space-y-1">
                    {publishedViews.map((view) => (
                      <li key={view.name}>
                        <button
                          type="button"
                          onClick={() => selectTable(view.name)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                            view.name === activeTable
                              ? 'border-sky-glow/40 bg-sky-glow/10'
                              : 'border-white/8 bg-white/2 hover:border-white/16 hover:bg-white/6',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate figure text-xs text-mist-100">
                              {view.requestedAs}
                            </span>
                            <span className="block truncate text-3xs text-mist-500">
                              view over {view.name.replace(/^v_/, '')}
                            </span>
                          </span>
                          <span className="shrink-0 figure text-2xs text-mist-300">
                            {view.rowCount}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {/* ---------------------------------------------------------- records */}
        <Card>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="figure text-sm">{selected?.name ?? activeTable}</span>
                {selected && (
                  <Badge tone="neutral" size="sm">
                    {selected.kind === 'view' ? 'view' : 'table'}
                  </Badge>
                )}
                {selected?.requestedAs !== selected?.name && selected && (
                  <Badge tone="info" size="sm">
                    requested as {selected.requestedAs}
                  </Badge>
                )}
              </span>
            }
            subtitle={selected?.description}
            icon={<Rows3 className="size-4 text-pulse-300" />}
            actions={
              rows.data ? (
                <span className="text-right figure text-2xs text-mist-500">
                  {formatNumber(rows.data.total)} rows
                </span>
              ) : null
            }
          />
          <CardBody className="space-y-3 pt-3">
            {rows.data && <ColumnChips columns={rows.data.columns} />}

            {rows.isError ? (
              <ErrorState
                title="Could not read this table"
                message={(rows.error as Error)?.message}
                onRetry={() => void rows.refetch()}
              />
            ) : rows.isLoading ? (
              <PanelSkeleton />
            ) : !rows.data?.rows.length ? (
              <EmptyState
                title="No records"
                description="This table is empty — run `npm run db:refresh` to rebuild the demo dataset."
              />
            ) : (
              <>
                <div className="scrollbar-none -mx-1 overflow-x-auto px-1">
                  <table className="w-full min-w-[46rem] border-collapse text-left">
                    <thead>
                      <tr>
                        {rows.data.columns.map((column) => (
                          <th
                            key={column.name}
                            scope="col"
                            className="border-b border-white/10 pb-2 align-bottom"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setSort((current) =>
                                  current?.column === column.name
                                    ? { column: column.name, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                                    : { column: column.name, direction: 'asc' },
                                )
                              }
                              className={cn(
                                'inline-flex items-center gap-1 figure text-2xs transition-colors',
                                sort?.column === column.name ? 'text-pulse-200' : 'text-mist-400 hover:text-mist-200',
                              )}
                              title={`Sort by ${column.name} (${column.dataType})`}
                            >
                              <ArrowDownWideNarrow
                                className={cn(
                                  'size-3',
                                  sort?.column === column.name && sort.direction === 'desc' && 'rotate-180',
                                )}
                              />
                              {column.name}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.data.rows.map((row, rowIndex) => (
                        <tr
                          key={`${activeTable}-${page}-${rowIndex}`}
                          className="border-b border-white/5 last:border-0 hover:bg-white/4"
                        >
                          {rows.data!.columns.map((column) => (
                            <td
                              key={column.name}
                              className="max-w-[18rem] truncate py-2 pr-4 figure text-xs text-mist-200"
                              title={String(row[column.name] ?? '')}
                            >
                              {formatCell(row[column.name], columnIndex.get(column.name))}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-3">
                  <p className="figure text-2xs text-mist-500">
                    rows {rows.data.offset + 1}–{Math.min(rows.data.offset + PAGE_SIZE, rows.data.total)} of{' '}
                    {formatNumber(rows.data.total)} · order by {rows.data.orderBy}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<ChevronLeft className="size-3.5" />}
                      disabled={page === 0}
                      onClick={() => setPage((current) => Math.max(0, current - 1))}
                    >
                      Prev
                    </Button>
                    <span className="figure text-2xs text-mist-400">
                      {page + 1} / {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconRight={<ChevronRight className="size-3.5" />}
                      disabled={page + 1 >= totalPages}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
