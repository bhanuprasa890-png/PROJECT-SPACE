import type { Queryable } from '../db/client';

/**
 * Geographic reads for the Google Maps layer.
 *
 * Geometry comes from the canonical published dataset — `route_stops` joined to
 * `routes` / `lines` — so the map draws exactly what the Data Explorer shows.
 * Live state comes from the operational tables the rest of the app reads:
 * `v_line_crowding_now` (measured load per stop), `vehicle_snapshots` (simulated
 * fleet positions) and `alerts` (service notices). Nothing here is generated in
 * code: every coordinate and every crowd value is a row in Postgres.
 *
 * DEMO DATA — the city is synthetic, the fleet is simulated and every crowd figure
 * is either a measurement of simulated telemetry or a model prediction.
 */

export interface MapStopRow {
  route_id: string;
  route_number: string;
  route_name: string;
  color: string;
  mode: string;
  headway_minutes: number;
  capacity_per_vehicle: number;
  stop_name: string;
  stop_order: number;
  latitude: number;
  longitude: number;
  stop_id: string | null;
  is_interchange: boolean | null;
  daily_boardings: number | null;
  live_ratio: number | null;
  live_level: string | null;
  onboard_count: number | null;
  observed_at: string | null;
}

export interface MapVehicleRow {
  id: string;
  vehicle_number: string;
  route_id: string;
  route_number: string;
  route_name: string;
  color: string;
  mode: string;
  capacity: number;
  current_occupancy: number;
  status: string;
  latitude: number;
  longitude: number;
  updated_at: string;
  next_stop_name: string | null;
  predicted_pct: number | null;
  predicted_level: string | null;
  confidence_pct: number | null;
}

export interface MapForecastRow {
  route_id: string;
  route_number: string;
  route_name: string;
  color: string;
  mode: string;
  predicted_pct: number;
  predicted_level: string;
  confidence_pct: number;
  prediction_time: string;
  stop_name: string | null;
}

export interface MapAlertRow {
  id: string;
  severity: string;
  category: string;
  title: string;
  status: string;
  route_id: string | null;
  route_number: string | null;
  color: string | null;
  stop_name: string | null;
  latitude: number | null;
  longitude: number | null;
  starts_at: string;
}

/* -------------------------------------------------------------------------- */
/* Route geometry                                                             */
/* -------------------------------------------------------------------------- */

const ROUTE_STOP_SELECT = `
  select
    rs.route_id,
    r.route_number,
    r.route_name,
    l.color,
    l.mode,
    l.headway_minutes,
    l.capacity_per_vehicle,
    rs.stop_name,
    rs.stop_order,
    rs.latitude,
    rs.longitude,
    s.id                        as stop_id,
    s.is_interchange,
    s.daily_boardings,
    c.occupancy_ratio           as live_ratio,
    c.level                     as live_level,
    c.onboard_count,
    c.observed_at
  from route_stops rs
  join routes r on r.id = rs.route_id
  join lines l on l.id = rs.route_id
  left join stops s on s.name = rs.stop_name
  left join v_line_crowding_now c on c.stop_id = s.id and c.line_id = rs.route_id
  where r.active`;

/** Every ordered route stop, with the latest measured load where one exists. */
export async function listRouteStops(db: Queryable): Promise<MapStopRow[]> {
  return db.query<MapStopRow>(`${ROUTE_STOP_SELECT} order by r.route_number, rs.stop_order`);
}

/** Route stops for a subset of routes (the journey map). */
export async function listRouteStopsForRoutes(db: Queryable, routeIds: string[]): Promise<MapStopRow[]> {
  if (!routeIds.length) return [];
  return db.query<MapStopRow>(
    `${ROUTE_STOP_SELECT} and rs.route_id = any($1::text[]) order by r.route_number, rs.stop_order`,
    [routeIds],
  );
}

/* -------------------------------------------------------------------------- */
/* Fleet + forecasts                                                          */
/* -------------------------------------------------------------------------- */

/** Route-level AI forecast: the next stored prediction for every route. */
export async function listRouteForecasts(db: Queryable): Promise<MapForecastRow[]> {
  return db.query<MapForecastRow>(
    `select distinct on (p.route_id)
       p.route_id,
       r.route_number,
       r.route_name,
       l.color,
       l.mode,
       p.predicted_occupancy_percentage as predicted_pct,
       p.crowd_level                    as predicted_level,
       p.confidence_percentage          as confidence_pct,
       p.prediction_time,
       worst.stop_name
     from occupancy_predictions p
     join routes r on r.id = p.route_id
     join lines l on l.id = p.route_id
     left join lateral (
       select rs.stop_name
       from route_stops rs
       join stops s2 on s2.name = rs.stop_name
       join v_line_crowding_now c2 on c2.stop_id = s2.id and c2.line_id = p.route_id
       order by c2.occupancy_ratio desc
       limit 1
     ) worst on true
     where p.prediction_time >= now() - interval '10 minutes'
     order by p.route_id, p.prediction_time asc`,
  );
}

/** Simulated fleet positions with the occupancy each vehicle is carrying. */
export async function listVehiclePositions(db: Queryable): Promise<MapVehicleRow[]> {
  return db.query<MapVehicleRow>(
    `with next_forecast as (
       select distinct on (route_id)
         route_id,
         predicted_occupancy_percentage as predicted_pct,
         crowd_level                    as predicted_level,
         confidence_percentage          as confidence_pct
       from occupancy_predictions
       where prediction_time >= now() - interval '10 minutes'
       order by route_id, prediction_time asc
     )
     select
       vs.id,
       vs.vehicle_number,
       vs.route_id,
       r.route_number,
       r.route_name,
       l.color,
       l.mode,
       vs.capacity,
       vs.current_occupancy,
       vs.status,
       vs.latitude,
       vs.longitude,
       vs.updated_at,
       ns.name                as next_stop_name,
       f.predicted_pct,
       f.predicted_level,
       f.confidence_pct
     from vehicle_snapshots vs
     join routes r on r.id = vs.route_id
     join lines l on l.id = vs.route_id
     left join vehicles v on v.id = vs.id
     left join stops ns on ns.id = v.next_stop_id
     left join next_forecast f on f.route_id = vs.route_id
     order by r.route_number, vs.vehicle_number`,
  );
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                    */
/* -------------------------------------------------------------------------- */

/** Active and scheduled notices, geocoded to their stop or their route origin. */
export async function listMapAlerts(db: Queryable): Promise<MapAlertRow[]> {
  return db.query<MapAlertRow>(
    `select
       a.id,
       a.severity,
       a.category,
       a.title,
       a.status,
       a.line_id       as route_id,
       l.code          as route_number,
       l.color,
       coalesce(s.name, origin.stop_name)  as stop_name,
       coalesce(s.lat, origin.latitude)    as latitude,
       coalesce(s.lng, origin.longitude)   as longitude,
       a.starts_at
     from alerts a
     left join lines l on l.id = a.line_id
     left join stops s on s.id = a.stop_id
     left join lateral (
       select rs.stop_name, rs.latitude, rs.longitude
       from route_stops rs
       where rs.route_id = a.line_id
       order by rs.stop_order
       limit 1
     ) origin on true
     where a.status in ('active', 'scheduled')
     order by
       case a.severity when 'critical' then 0 when 'major' then 1 when 'minor' then 2 else 3 end,
       a.starts_at desc
     limit 40`,
  );
}
