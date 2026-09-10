import type { Queryable } from '../db/client';
import type {
  Agency,
  LineDetail,
  LineStop,
  Stop,
  TransitLine,
  TransitMode,
} from '../../shared/types';

/**
 * Network repository — the only place in the codebase that knows the SQL
 * shape of `agencies`, `stops`, `lines`, `line_stops` and `service_patterns`.
 */

type StopRow = {
  id: string;
  agency_id: string;
  code: string;
  name: string;
  description: string | null;
  lat: number | string;
  lng: number | string;
  zone: string | null;
  is_interchange: boolean;
  daily_boardings: number | string;
};

type LineRow = {
  id: string;
  agency_id: string;
  code: string;
  name: string;
  mode: TransitMode;
  color: string;
  capacity_per_vehicle: number | string;
  headway_minutes: number | string;
  is_active: boolean;
  stop_count?: number | string | null;
};

const mapStop = (row: StopRow): Stop => ({
  id: row.id,
  agencyId: row.agency_id,
  code: row.code,
  name: row.name,
  description: row.description,
  lat: Number(row.lat),
  lng: Number(row.lng),
  zone: row.zone,
  isInterchange: row.is_interchange,
  dailyBoardings: Number(row.daily_boardings),
});

const mapLine = (row: LineRow): TransitLine => ({
  id: row.id,
  agencyId: row.agency_id,
  code: row.code,
  name: row.name,
  mode: row.mode,
  color: row.color,
  capacityPerVehicle: Number(row.capacity_per_vehicle),
  headwayMinutes: Number(row.headway_minutes),
  isActive: row.is_active,
  stopCount: row.stop_count == null ? undefined : Number(row.stop_count),
});

export async function getAgency(db: Queryable): Promise<Agency | null> {
  const row = await db.one<{
    id: string;
    name: string;
    city: string;
    timezone: string;
  }>('select id, name, city, timezone from agencies order by name limit 1');
  if (!row) return null;
  return { id: row.id, name: row.name, city: row.city, timezone: row.timezone };
}

export async function listStops(
  db: Queryable,
  options: { q?: string; limit?: number; interchangeOnly?: boolean } = {},
): Promise<Stop[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (options.q) {
    params.push(`%${options.q.toLowerCase()}%`);
    where.push(`(lower(s.name) like $${params.length} or lower(s.code) like $${params.length})`);
  }
  if (options.interchangeOnly) {
    where.push('s.is_interchange = true');
  }

  params.push(Math.min(options.limit ?? 200, 500));
  const rows = await db.query<StopRow>(
    `select s.*
     from stops s
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by s.is_interchange desc, s.daily_boardings desc, s.name
     limit $${params.length}`,
    params,
  );
  return rows.map(mapStop);
}

export async function getStop(db: Queryable, stopId: string): Promise<Stop | null> {
  const row = await db.one<StopRow>('select * from stops where id = $1 or code = $1', [stopId]);
  return row ? mapStop(row) : null;
}

export async function listLines(db: Queryable): Promise<TransitLine[]> {
  const rows = await db.query<LineRow>(
    `select l.*, (select count(*) from line_stops ls where ls.line_id = l.id) as stop_count
     from lines l
     where l.is_active
     order by l.mode, l.code`,
  );
  return rows.map(mapLine);
}

export interface ServiceWindow {
  timeZone: string;
  firstDeparture: string;
  lastDeparture: string;
  /** Next instant the network starts running, as an ISO timestamp. */
  nextStartAt: string;
}

/**
 * The network's daily service window and the next time it opens, evaluated in
 * the agency timezone from `service_patterns`. Used when a rider plans a journey
 * after the last departure of the day.
 */
export async function getServiceWindow(db: Queryable): Promise<ServiceWindow | null> {
  const row = await db.one<{
    time_zone: string;
    first_departure: string;
    last_departure: string;
    next_start_at: string | Date;
  }>(
    `with bounds as (
       select min(sp.first_departure) as first_departure,
              max(sp.last_departure)  as last_departure
       from service_patterns sp
     ),
     tz as (select timezone from agencies order by id limit 1)
     select tz.timezone as time_zone,
            b.first_departure::text as first_departure,
            b.last_departure::text  as last_departure,
            (case
               when (now() at time zone tz.timezone)::time < b.first_departure
                 then ((now() at time zone tz.timezone)::date + b.first_departure)
                 else (((now() at time zone tz.timezone)::date + 1) + b.first_departure)
             end) at time zone tz.timezone as next_start_at
     from bounds b cross join tz`,
  );

  if (!row) return null;
  return {
    timeZone: row.time_zone,
    firstDeparture: row.first_departure,
    lastDeparture: row.last_departure,
    nextStartAt: new Date(row.next_start_at).toISOString(),
  };
}

export async function getLineByIdOrCode(db: Queryable, idOrCode: string): Promise<TransitLine | null> {
  const row = await db.one<LineRow>(
    `select l.*, (select count(*) from line_stops ls where ls.line_id = l.id) as stop_count
     from lines l
     where l.id = $1 or upper(l.code) = upper($1)`,
    [idOrCode],
  );
  return row ? mapLine(row) : null;
}

export async function getLineDetail(db: Queryable, idOrCode: string): Promise<LineDetail | null> {
  const line = await getLineByIdOrCode(db, idOrCode);
  if (!line) return null;

  const stopRows = await db.query<{
    line_id: string;
    stop_id: string;
    seq: number;
    travel_minutes_from_prev: number;
    stop: StopRow;
  }>(
    `select ls.line_id, ls.stop_id, ls.seq, ls.travel_minutes_from_prev,
            row_to_json(s) as stop
     from line_stops ls
     join stops s on s.id = ls.stop_id
     where ls.line_id = $1
     order by ls.seq`,
    [line.id],
  );

  const stops: LineStop[] = stopRows.map((row) => ({
    lineId: row.line_id,
    stopId: row.stop_id,
    seq: Number(row.seq),
    travelMinutesFromPrev: Number(row.travel_minutes_from_prev),
    stop: mapStop(row.stop),
  }));

  return { line, stops, activeAlerts: [] };
}

export interface Departure {
  lineId: string;
  lineCode: string;
  lineName: string;
  lineColor: string;
  mode: TransitMode;
  direction: number;
  departureAt: string;
  offsetMinutes: number;
  headwayMinutes: number;
  vehicleCode: string | null;
  vehicleCapacity: number;
}

export async function listDepartures(
  db: Queryable,
  stopId: string,
  fromIso: string,
  horizonMinutes = 90,
): Promise<Departure[]> {
  const rows = await db.query<{
    line_id: string;
    line_code: string;
    line_name: string;
    line_color: string;
    mode: TransitMode;
    direction: number;
    departure_at: string | Date;
    offset_minutes: number;
    headway_minutes: number;
    vehicle_code: string | null;
    vehicle_capacity: number | null;
  }>(
    `select * from fn_next_departures($1, $2::timestamptz, $3::integer)`,
    [stopId, fromIso, horizonMinutes],
  );

  return rows.map((row) => ({
    lineId: row.line_id,
    lineCode: row.line_code,
    lineName: row.line_name,
    lineColor: row.line_color,
    mode: row.mode,
    direction: Number(row.direction),
    departureAt: new Date(row.departure_at).toISOString(),
    offsetMinutes: Number(row.offset_minutes),
    headwayMinutes: Number(row.headway_minutes),
    vehicleCode: row.vehicle_code,
    vehicleCapacity: Number(row.vehicle_capacity ?? 0),
  }));
}

export interface NetworkSnapshot {
  stops: Stop[];
  lines: TransitLine[];
  connections: { lineId: string; stopId: string; seq: number; travelMinutesFromPrev: number }[];
}

/**
 * Loads the whole network graph in three queries. The planner resolves
 * journeys from this snapshot rather than issuing a query per hop.
 */
export async function loadNetwork(db: Queryable): Promise<NetworkSnapshot> {
  const [stops, lines, connections] = await Promise.all([
    listStops(db, { limit: 500 }),
    listLines(db),
    db.query<{ line_id: string; stop_id: string; seq: number; travel_minutes_from_prev: number }>(
      `select line_id, stop_id, seq, travel_minutes_from_prev
       from line_stops
       order by line_id, seq`,
    ),
  ]);

  return {
    stops,
    lines,
    connections: connections.map((row) => ({
      lineId: row.line_id,
      stopId: row.stop_id,
      seq: Number(row.seq),
      travelMinutesFromPrev: Number(row.travel_minutes_from_prev),
    })),
  };
}
