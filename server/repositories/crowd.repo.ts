import type { Queryable } from '../db/client';
import type { CrowdHotspot, CrowdLevel, HopSource, TransitMode } from '../../shared/types';

/**
 * Crowd repository — reads the telemetry tables and the statistical baselines
 * learned from them (`v_line_hourly_profile`). The crowd model layers its
 * prediction on top of these rows; predictions are persisted back into
 * `crowd_forecasts` so the operational picture is shared across clients.
 */

export interface CrowdRecord {
  lineId: string;
  stopId: string;
  observedAt: string;
  headcount: number;
  capacity: number;
  ratio: number;
  level: CrowdLevel;
  source: HopSource;
}

export interface BaselineCell {
  lineId: string;
  stopId: string | null;
  dayType: 'weekday' | 'saturday' | 'sunday';
  hourOfDay: number;
  avgRatio: number;
  p90Ratio: number;
  sampleSize: number;
}

type CrowdRow = {
  line_id: string;
  stop_id: string;
  observed_at: string | Date;
  onboard_count: number | string;
  capacity: number | string;
  occupancy_ratio: number | string;
  level: CrowdLevel;
  source: HopSource;
};

const mapCrowd = (row: CrowdRow): CrowdRecord => ({
  lineId: row.line_id,
  stopId: row.stop_id,
  observedAt: new Date(row.observed_at).toISOString(),
  headcount: Number(row.onboard_count),
  capacity: Number(row.capacity),
  ratio: Number(row.occupancy_ratio),
  level: row.level,
  source: row.source,
});

/** Most recent reading per line/stop, straight from the telemetry table. */
export async function listLatestReadings(
  db: Queryable,
  options: { lineIds?: string[]; stopIds?: string[]; limit?: number } = {},
): Promise<CrowdRecord[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (options.lineIds?.length) {
    params.push(options.lineIds);
    where.push(`line_id = any($${params.length})`);
  }
  if (options.stopIds?.length) {
    params.push(options.stopIds);
    where.push(`stop_id = any($${params.length})`);
  }
  params.push(Math.min(options.limit ?? 300, 1000));

  const rows = await db.query<CrowdRow>(
    `select line_id, stop_id, observed_at, onboard_count, capacity, occupancy_ratio, level, source
     from v_latest_crowd_reading
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by occupancy_ratio desc
     limit $${params.length}`,
    params,
  );
  return rows.map(mapCrowd);
}

export async function listHotspots(db: Queryable, limit = 6): Promise<CrowdHotspot[]> {
  const rows = await db.query<{
    line_id: string;
    line_code: string;
    line_name: string;
    line_color: string;
    mode: TransitMode;
    stop_id: string;
    stop_name: string;
    occupancy_ratio: number | string;
    level: CrowdLevel;
    onboard_count: number | string;
    capacity: number | string;
    observed_at: string | Date;
  }>(
    `select distinct on (c.line_id)
            c.line_id, c.line_code, c.line_name, c.line_color, c.mode,
            c.stop_id, c.stop_name, c.occupancy_ratio, c.level,
            c.onboard_count, c.capacity, c.observed_at
     from v_line_crowding_now c
     order by c.line_id, c.occupancy_ratio desc`,
  );

  return rows
    .map((row) => ({
      lineId: row.line_id,
      lineCode: row.line_code,
      lineName: row.line_name,
      lineColor: row.line_color,
      mode: row.mode,
      stopId: row.stop_id,
      stopName: row.stop_name,
      ratio: Number(row.occupancy_ratio),
      level: row.level,
      headcount: Number(row.onboard_count),
      capacity: Number(row.capacity),
      observedAt: new Date(row.observed_at).toISOString(),
    }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);
}

/**
 * Statistical baseline for a line/stop pair from the last 14 days of telemetry,
 * per hour of day. Falls back to a line-wide profile when the stop has no
 * history of its own.
 */
export async function listBaselines(
  db: Queryable,
  options: { lineIds?: string[]; dayTypes?: string[] } = {},
): Promise<BaselineCell[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (options.lineIds?.length) {
    params.push(options.lineIds);
    where.push(`line_id = any($${params.length})`);
  }
  if (options.dayTypes?.length) {
    params.push(options.dayTypes);
    where.push(`day_type = any($${params.length})`);
  }

  const rows = await db.query<{
    line_id: string;
    stop_id: string | null;
    day_type: 'weekday' | 'saturday' | 'sunday';
    hour_of_day: number;
    avg_ratio: number | string;
    p90_ratio: number | string | null;
    sample_size: number;
  }>(
    `select line_id, stop_id, day_type, hour_of_day, avg_ratio, p90_ratio, sample_size
     from v_line_hourly_profile
     ${where.length ? `where ${where.join(' and ')}` : ''}
     union all
     select line_id, null as stop_id, day_type, hour_of_day, avg_ratio, p90_ratio, sample_size
     from v_line_hourly_profile_all_stops
     ${where.length ? `where ${where.join(' and ')}` : ''}`,
    params,
  );

  return rows.map((row) => ({
    lineId: row.line_id,
    stopId: row.stop_id,
    dayType: row.day_type,
    hourOfDay: Number(row.hour_of_day),
    avgRatio: Number(row.avg_ratio),
    p90Ratio: Number(row.p90_ratio ?? row.avg_ratio),
    sampleSize: Number(row.sample_size),
  }));
}

/** Trailing observations for a single line/stop — used to draw live history. */
export async function listRecentObservations(
  db: Queryable,
  options: { lineId: string; stopId: string; hours?: number; limit?: number },
): Promise<CrowdRecord[]> {
  const rows = await db.query<CrowdRow>(
    `select line_id, stop_id, observed_at, onboard_count, capacity, occupancy_ratio,
            fn_crowd_level(occupancy_ratio) as level, source
     from crowd_observations
     where line_id = $1 and stop_id = $2
       and observed_at > now() - make_interval(hours => $3::integer)
     order by observed_at desc
     limit $4`,
    [options.lineId, options.stopId, options.hours ?? 6, options.limit ?? 40],
  );
  return rows.map(mapCrowd).reverse();
}

/** Persisted forecast rows for a line/stop inside a time window. */
export async function listPersistedForecasts(
  db: Queryable,
  options: { lineId: string; stopId: string; fromIso: string; toIso: string },
): Promise<
  {
    targetAt: string;
    horizonMinutes: number;
    ratio: number;
    headcount: number;
    confidence: number;
    modelVersion: string;
  }[]
> {
  const rows = await db.query<{
    target_at: string | Date;
    horizon_minutes: number;
    predicted_ratio: number | string;
    predicted_headcount: number;
    confidence: number | string;
    model_version: string;
  }>(
    `select target_at, horizon_minutes, predicted_ratio, predicted_headcount, confidence, model_version
     from crowd_forecasts
     where line_id = $1 and stop_id = $2 and target_at between $3::timestamptz and $4::timestamptz
     order by target_at`,
    [options.lineId, options.stopId, options.fromIso, options.toIso],
  );

  return rows.map((row) => ({
    targetAt: new Date(row.target_at).toISOString(),
    horizonMinutes: Number(row.horizon_minutes),
    ratio: Number(row.predicted_ratio),
    headcount: Number(row.predicted_headcount),
    confidence: Number(row.confidence),
    modelVersion: row.model_version,
  }));
}

export interface ForecastUpsertRow {
  lineId: string;
  stopId: string;
  targetAt: string;
  horizonMinutes: number;
  ratio: number;
  headcount: number;
  lowerRatio: number;
  upperRatio: number;
  confidence: number;
  modelVersion: string;
  factors: Record<string, number | string>;
}

/** Persist model output so operator tooling sees the same picture as riders. */
export async function upsertForecasts(db: Queryable, rows: ForecastUpsertRow[]): Promise<number> {
  if (!rows.length) return 0;
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const base = index * 11;
    values.push(
      row.lineId,
      row.stopId,
      row.targetAt,
      row.horizonMinutes,
      row.ratio,
      row.headcount,
      row.lowerRatio,
      row.upperRatio,
      row.confidence,
      row.modelVersion,
      JSON.stringify(row.factors),
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}::timestamptz, $${base + 4}, $${base + 5},
             $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}::jsonb)`;
  });

  await db.query(
    `insert into crowd_forecasts (
       line_id, stop_id, target_at, horizon_minutes, predicted_ratio, predicted_headcount,
       lower_ratio, upper_ratio, confidence, model_version, factors
     ) values ${tuples.join(', ')}
     on conflict (line_id, stop_id, target_at, model_version) do update set
       predicted_ratio = excluded.predicted_ratio,
       predicted_headcount = excluded.predicted_headcount,
       lower_ratio = excluded.lower_ratio,
       upper_ratio = excluded.upper_ratio,
       confidence = excluded.confidence,
       factors = excluded.factors,
       created_at = now()`,
    values,
  );
  return rows.length;
}

/** Aggregate occupancy health for a trailing window (operator KPIs). */
export async function occupancyStats(
  db: Queryable,
  hours = 24,
): Promise<{
  avgRatio: number;
  /** Same metric for the preceding window of equal length. */
  previousAvgRatio: number;
  peakRatio: number;
  sampleCount: number;
  crushEvents: number;
  hourlySeries: number[];
}> {
  const summary = await db.one<{
    avg_ratio: number | string | null;
    previous_avg_ratio: number | string | null;
    peak_ratio: number | string | null;
    sample_count: number;
    crush_events: number;
  }>(
    `select round(avg(occupancy_ratio), 3) as avg_ratio,
            round(avg(occupancy_ratio) filter (
              where observed_at <= now() - make_interval(hours => $1::integer)
            ), 3) as previous_avg_ratio,
            round(max(occupancy_ratio), 3) as peak_ratio,
            count(*)::int as sample_count,
            count(*) filter (where occupancy_ratio >= 1.0)::int as crush_events
     from crowd_observations
     where observed_at > now() - make_interval(hours => ($1 * 2)::integer)`,
    [hours],
  );

  const seriesRows = await db.query<{ bucket: string | Date; avg_ratio: number | string }>(
    `select date_trunc('hour', observed_at) as bucket,
            round(avg(occupancy_ratio), 3) as avg_ratio
     from crowd_observations
     where observed_at > now() - make_interval(hours => $1::integer)
     group by 1
     order by 1`,
    [hours],
  );

  return {
    avgRatio: Number(summary?.avg_ratio ?? 0),
    previousAvgRatio: Number(summary?.previous_avg_ratio ?? summary?.avg_ratio ?? 0),
    peakRatio: Number(summary?.peak_ratio ?? 0),
    sampleCount: Number(summary?.sample_count ?? 0),
    crushEvents: Number(summary?.crush_events ?? 0),
    hourlySeries: seriesRows.map((row) => Number(row.avg_ratio)),
  };
}
