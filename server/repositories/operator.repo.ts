import type { Queryable } from '../db/client';
import { crowdLevelFromRatio } from '../../shared/crowd';
import type { CrowdLevel, FleetVehicle, LineLoadRow, TransitMode } from '../../shared/types';

/** Local alias so the row mapper stays terse. */
const crowdLevel = crowdLevelFromRatio;

/**
 * Operator repository — fleet state, per-line load profiles and the raw
 * counters behind the control-room KPIs.
 */

export async function listFleet(db: Queryable): Promise<FleetVehicle[]> {
  const rows = await db.query<{
    id: string;
    code: string;
    line_id: string;
    line_code: string;
    line_color: string;
    mode: TransitMode;
    status: FleetVehicle['status'];
    capacity: number;
    headcount: number | string;
    ratio: number | string;
    level: CrowdLevel;
    next_stop_name: string | null;
    adherence_pct: number | string;
    last_ping: string | Date;
  }>(
    `select
       v.id,
       v.code,
       l.id   as line_id,
       l.code as line_code,
       l.color as line_color,
       l.mode,
       v.status,
       v.capacity_total as capacity,
       greatest(1, round(coalesce(r.occupancy_ratio, line_avg.avg_ratio, 0.42) * v.capacity_total))::int as headcount,
       round(coalesce(r.occupancy_ratio, line_avg.avg_ratio, 0.42), 3) as ratio,
       fn_crowd_level(coalesce(r.occupancy_ratio, line_avg.avg_ratio, 0.42)) as level,
       s.name as next_stop_name,
       v.adherence_pct,
       v.last_ping
     from vehicles v
     join lines l on l.id = v.line_id
     left join v_latest_crowd_reading r
       on r.line_id = v.line_id and r.stop_id = v.next_stop_id
     left join (
       select line_id, avg(occupancy_ratio) as avg_ratio
       from v_latest_crowd_reading group by line_id
     ) line_avg on line_avg.line_id = v.line_id
     left join stops s on s.id = v.next_stop_id
     order by v.status, ratio desc, v.code`,
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    lineId: row.line_id,
    lineCode: row.line_code,
    lineColor: row.line_color,
    mode: row.mode,
    status: row.status,
    capacity: Number(row.capacity),
    headcount: Number(row.headcount),
    ratio: Number(row.ratio),
    level: row.level,
    nextStopName: row.next_stop_name ?? 'Depot',
    adherencePct: Number(row.adherence_pct),
    lastPing: new Date(row.last_ping).toISOString(),
  }));
}

export async function listLineLoad(db: Queryable, dayType = 'weekday'): Promise<LineLoadRow[]> {
  const rows = await db.query<{
    line_id: string;
    line_code: string;
    line_name: string;
    color: string;
    mode: TransitMode;
    avg_ratio: number | string | null;
    peak_ratio: number | string | null;
    peak_hour: number | null;
    vehicles_in_service: number;
    on_time_pct: number | string | null;
    hourly_profile: (number | string)[] | null;
  }>(
    `select
       l.id   as line_id,
       l.code as line_code,
       l.name as line_name,
       l.color,
       l.mode,
       (select round(avg(occupancy_ratio), 3) from crowd_observations o
         where o.line_id = l.id and o.observed_at > now() - interval '24 hours') as avg_ratio,
       (select round(max(occupancy_ratio), 3) from crowd_observations o
         where o.line_id = l.id and o.observed_at > now() - interval '24 hours') as peak_ratio,
       (select hour_of_day from v_operator_line_load p
         where p.line_id = l.id and p.day_type = $1
         order by avg_ratio desc limit 1) as peak_hour,
       (select count(*)::int from vehicles v
         where v.line_id = l.id and v.status = 'in_service') as vehicles_in_service,
       (select round(100.0 * count(*) filter (where v.adherence_pct >= 95) / greatest(count(*), 1), 1)
          from vehicles v where v.line_id = l.id and v.status = 'in_service') as on_time_pct,
       (select array_agg(round(coalesce(p.avg_ratio, 0)::numeric, 3)::float8 order by h.hour)
        from generate_series(0, 23) as h(hour)
        left join v_operator_line_load p
          on p.line_id = l.id and p.day_type = $1 and p.hour_of_day = h.hour) as hourly_profile
     from lines l
     where l.is_active
     order by avg_ratio desc nulls last`,
    [dayType],
  );

  return rows.map((row) => {
    const avgRatio = Number(row.avg_ratio ?? 0);
    return {
      lineId: row.line_id,
      lineCode: row.line_code,
      lineName: row.line_name,
      color: row.color,
      mode: row.mode,
      avgRatio,
      peakRatio: Number(row.peak_ratio ?? avgRatio),
      peakHour: Number(row.peak_hour ?? 0),
      // Operators triage on the peak, not the 24-hour mean.
      level: crowdLevel(Number(row.peak_ratio ?? avgRatio)),
      vehiclesInService: Number(row.vehicles_in_service),
      onTimePct: Number(row.on_time_pct ?? 0),
      hourlyProfile: (row.hourly_profile ?? []).map((value) => Number(value)),
    };
  });
}

export async function listFleetStats(db: Queryable): Promise<{
  total: number;
  inService: number;
  maintenance: number;
  avgAdherence: number;
}> {
  const row = await db.one<{
    total: number;
    in_service: number;
    maintenance: number;
    avg_adherence: number | string | null;
  }>(
    `select count(*)::int as total,
            count(*) filter (where status = 'in_service')::int as in_service,
            count(*) filter (where status = 'maintenance')::int as maintenance,
            round(avg(adherence_pct), 2) as avg_adherence
     from vehicles`,
  );

  return {
    total: Number(row?.total ?? 0),
    inService: Number(row?.in_service ?? 0),
    maintenance: Number(row?.maintenance ?? 0),
    avgAdherence: Number(row?.avg_adherence ?? 0),
  };
}

/**
 * Counter of forecast crush-load events in the next `hours`, used for the
 * "predicted crowding events" KPI.
 */
export async function countUpcomingCrowdingEvents(
  db: Queryable,
  hours = 2,
  threshold = 0.85,
): Promise<{ current: number; previous: number }> {
  const row = await db.one<{ upcoming: number; historical: number }>(
    `select
       (select count(*)::int from crowd_forecasts
         where target_at between now() and now() + make_interval(hours => $1::integer)
           and predicted_ratio >= $2) as upcoming,
       (select count(*)::int from crowd_observations
         where observed_at between now() - make_interval(hours => ($1 * 2)::integer)
                                and now() - make_interval(hours => $1::integer)
           and occupancy_ratio >= $2) as historical`,
    [hours, threshold],
  );
  return { current: Number(row?.upcoming ?? 0), previous: Number(row?.historical ?? 0) };
}

export async function getNetworkCounts(db: Queryable): Promise<Record<string, number>> {
  const row = await db.one<{
    stop_count: number;
    interchange_count: number;
    line_count: number;
    connection_count: number;
    vehicles_in_service: number;
    observation_count: number;
    forecast_count: number;
    active_alerts: number;
  }>('select * from v_network_summary');

  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  );
}
