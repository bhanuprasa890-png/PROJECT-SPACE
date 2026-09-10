-- =============================================================================
-- TransitPulse AI · 0005 · Canonical dataset projection + published views
-- =============================================================================
-- `fn_refresh_demo_dataset()` rebuilds the canonical route-level dataset from
-- the network model. It is called by the seed (`supabase/seed/0004_demo_dataset.sql`)
-- and can be re-run at any time from SQL or `npm run db:refresh`:
--
--     select * from fn_refresh_demo_dataset();
--
-- Because the canonical tables are *projected* rather than typed in by hand,
-- they can never drift away from the telemetry, forecasts and planner output
-- that the rest of the application uses.
--
-- DEMO / SIMULATED DATA — every row produced here is generated demo data.
-- =============================================================================

create or replace function fn_refresh_demo_dataset()
returns table (dataset_table text, row_count integer)
language plpgsql
as $$
declare
  v_time_weight  numeric := 1.0;
  v_crowd_weight numeric := 1.35;
begin
  select coalesce((value ->> 'time')::numeric, 1.0),
         coalesce((value ->> 'crowd')::numeric, 1.35)
    into v_time_weight, v_crowd_weight
  from model_config
  where key = 'planner_weights';

  v_time_weight  := coalesce(v_time_weight, 1.0);
  v_crowd_weight := coalesce(v_crowd_weight, 1.35);

  -- ---------------------------------------------------------------------------
  -- Reset (children first so foreign keys stay satisfied)
  -- ---------------------------------------------------------------------------
  delete from occupancy_predictions;
  delete from route_options;
  delete from service_alerts;
  delete from vehicle_snapshots;
  delete from route_stops;
  delete from routes;
  delete from app_users;

  -- ---------------------------------------------------------------------------
  -- routes ← lines (endpoints and duration come from the stop sequence)
  -- ---------------------------------------------------------------------------
  insert into routes (id, route_number, route_name, origin, destination,
                      estimated_duration_minutes, active, created_at)
  select
    l.id,
    l.code,
    l.name,
    first_stop.name,
    last_stop.stop_name,
    greatest(1, offsets.line_total_minutes),
    l.is_active,
    l.created_at
  from lines l
  join v_line_stop_offsets offsets on offsets.line_id = l.id and offsets.seq = 1
  join stops first_stop on first_stop.id = offsets.stop_id
  join lateral (
    select s.name as stop_name
    from line_stops ls
    join stops s on s.id = ls.stop_id
    where ls.line_id = l.id
    order by ls.seq desc
    limit 1
  ) as last_stop on true;

  -- ---------------------------------------------------------------------------
  -- route_stops ← line_stops (+ shared network stop registry)
  -- ---------------------------------------------------------------------------
  insert into route_stops (id, route_id, stop_name, latitude, longitude, stop_order, created_at)
  select
    'RS-' || l.code || '-' || lpad(ls.seq::text, 2, '0'),
    l.id,
    s.name,
    s.lat,
    s.lng,
    ls.seq,
    l.created_at
  from line_stops ls
  join lines l on l.id = ls.line_id
  join stops s on s.id = ls.stop_id;

  -- ---------------------------------------------------------------------------
  -- vehicle_snapshots ← vehicles + the line's live crowd reading
  -- ---------------------------------------------------------------------------
  insert into vehicle_snapshots (id, vehicle_number, route_id, capacity,
                                 current_occupancy, status, latitude, longitude, updated_at)
  select
    v.id,
    v.code,
    v.line_id,
    v.capacity_total,
    -- The fleet carries the line's current load, with a small deterministic
    -- spread so no two vehicles on a line report an identical figure.
    greatest(
      0,
      round(
        v.capacity_total
        * coalesce(live.occupancy_ratio, 0.35)
        * (0.90 + 0.05 * ((row_number() over (partition by v.line_id order by v.code) - 1) % 5))
      )::integer
    ),
    v.status,
    -- Position comes from the vehicle's next stop, nudged deterministically so
    -- two vehicles on the same line are not plotted on the exact same point.
    coalesce(next_stop.lat, 0) + ((row_number() over (partition by v.line_id order by v.code) - 3) * 0.0012),
    coalesce(next_stop.lng, 0) + ((row_number() over (partition by v.line_id order by v.code) - 3) * 0.0016),
    v.last_ping
  from vehicles v
  join routes r on r.id = v.line_id
  left join stops next_stop on next_stop.id = v.next_stop_id
  left join lateral (
    select c.occupancy_ratio
    from v_line_crowding_now c
    where c.line_id = v.line_id
    order by c.occupancy_ratio desc
    limit 1
  ) as live on true;

  -- ---------------------------------------------------------------------------
  -- occupancy_predictions ← crowd_forecasts (route-level worst case per slot)
  -- ---------------------------------------------------------------------------
  insert into occupancy_predictions (route_id, vehicle_id, prediction_time,
                                     predicted_occupancy_percentage, crowd_level,
                                     confidence_percentage, created_at)
  select
    slot.line_id,
    veh.id,
    slot.target_at,
    round(slot.peak_ratio * 100, 1),
    fn_crowd_level(slot.peak_ratio),
    round(slot.confidence * 100, 1),
    slot.generated_at
  from (
    select
      cf.line_id,
      cf.target_at,
      max(cf.predicted_ratio)                      as peak_ratio,
      min(cf.confidence)                           as confidence,
      max(cf.created_at)                           as generated_at
    from crowd_forecasts cf
    group by cf.line_id, cf.target_at
  ) as slot
  join routes r on r.id = slot.line_id
  join lateral (
    -- Deterministic vehicle assignment for the slot.
    select v.id
    from vehicles v
    where v.line_id = slot.line_id
    order by v.code
    offset (extract(epoch from slot.target_at)::bigint
            % greatest((select count(*) from vehicles x where x.line_id = slot.line_id), 1))
    limit 1
  ) as veh on true;

  -- ---------------------------------------------------------------------------
  -- route_options ← a scored alternative set per route, using the planner
  -- objective (time weight + waiting + crowd penalty × crowding weight)
  -- ---------------------------------------------------------------------------
  insert into route_options (id, route_id, travel_time_minutes, waiting_time_minutes,
                             crowd_penalty, total_score, created_at)
  select
    'RO-' || r.route_number || '-' || k.slot,
    r.id,
    greatest(1, k.travel_minutes),
    k.waiting_minutes,
    k.crowd_penalty,
    round(
      greatest(1, k.travel_minutes) * v_time_weight
      + k.waiting_minutes * 0.8
      + k.crowd_penalty * v_crowd_weight * 6,
      3
    ),
    now()
  from routes r
  join lines l on l.id = r.id
  join lateral (
    select coalesce(round(avg(c.occupancy_ratio), 3), 0.35) as live_ratio
    from v_line_crowding_now c
    where c.line_id = l.id
  ) as crowd on true
  cross join lateral (
    values
      ('direct',   r.estimated_duration_minutes,     greatest(2, l.headway_minutes / 2),
        round(crowd.live_ratio * 1.15, 3)),
      ('express',  greatest(1, r.estimated_duration_minutes - 3), l.headway_minutes,
        round(crowd.live_ratio * 1.30, 3)),
      ('frequent', r.estimated_duration_minutes + 2, greatest(1, l.headway_minutes / 3),
        round(crowd.live_ratio * 1.05, 3)),
      ('quietest', r.estimated_duration_minutes + 5, l.headway_minutes,
        round(crowd.live_ratio * 0.72, 3))
  ) as k(slot, travel_minutes, waiting_minutes, crowd_penalty);

  -- ---------------------------------------------------------------------------
  -- service_alerts ← alerts (route-level notices)
  -- ---------------------------------------------------------------------------
  insert into service_alerts (id, route_id, alert_type, message, severity,
                              predicted_occupancy, estimated_time_to_event,
                              active, created_at)
  select
    a.id,
    a.line_id,
    a.category,
    a.title || ' — ' || a.body,
    a.severity,
    -- Only crowding notices carry a predicted occupancy figure: the route's
    -- worst forecast load within the next two hours.
    case when a.category = 'crowding' then (
      select round(max(cf.predicted_ratio) * 100, 1)
      from crowd_forecasts cf
      where cf.line_id = a.line_id
        and cf.target_at between now() and now() + interval '2 hours'
    ) end,
    -- Minutes until the event this notice refers to.
    case
      when a.status = 'resolved' then null
      when a.starts_at > now() then greatest(0, round(extract(epoch from (a.starts_at - now())) / 60))
      when a.ends_at is not null then greatest(0, round(extract(epoch from (a.ends_at - now())) / 60))
      else null
    end,
    a.status = 'active',
    least(a.starts_at, now())
  from alerts a
  join routes r on r.id = a.line_id;

  -- ---------------------------------------------------------------------------
  -- app_users ← rider_profiles
  -- ---------------------------------------------------------------------------
  insert into app_users (id, name, email, role, created_at)
  select p.id, p.display_name, p.email, p.role, p.created_at
  from rider_profiles p;

  return query
    select 'routes'::text,                count(*)::integer from routes
    union all select 'route_stops',           count(*)::integer from route_stops
    union all select 'vehicle_snapshots',     count(*)::integer from vehicle_snapshots
    union all select 'occupancy_predictions', count(*)::integer from occupancy_predictions
    union all select 'route_options',         count(*)::integer from route_options
    union all select 'service_alerts',        count(*)::integer from service_alerts
    union all select 'app_users',             count(*)::integer from app_users;
end;
$$;

comment on function fn_refresh_demo_dataset() is
  'Rebuilds the canonical DEMO dataset (routes, stops, vehicles, predictions, options, alerts, users) from the network model. Returns the row count of each table.';

-- -----------------------------------------------------------------------------
-- Published names for the requested table shapes
-- -----------------------------------------------------------------------------
-- `stops`, `vehicles` and `alerts` are the network model in this application, so
-- a client that expects the published dataset shape (route_id, stop_name, …)
-- reads these read-only views instead. They carry `security_invoker` so Row
-- Level Security is evaluated for the *caller*, not the view owner.
-- -----------------------------------------------------------------------------
create or replace view v_stops as
  select id, route_id, stop_name, latitude, longitude, stop_order, created_at
  from route_stops;

create or replace view v_vehicles as
  select id, vehicle_number, route_id, capacity, current_occupancy, status,
         latitude, longitude, updated_at
  from vehicle_snapshots;

create or replace view v_alerts as
  select id, route_id, alert_type, message, severity, predicted_occupancy,
         estimated_time_to_event, active, created_at
  from service_alerts;

create or replace view v_users as
  select id, name, email, role, created_at
  from app_users;

alter view v_stops    set (security_invoker = true);
alter view v_vehicles set (security_invoker = true);
alter view v_alerts   set (security_invoker = true);
alter view v_users    set (security_invoker = true);

comment on view v_stops is    'Published stop list per route (requested `stops` shape) — DEMO DATA.';
comment on view v_vehicles is 'Published vehicle snapshot list (requested `vehicles` shape) — DEMO DATA.';
comment on view v_alerts is   'Published route alerts (requested `alerts` shape) — DEMO DATA.';
comment on view v_users is    'Published application users (requested `users` shape) — DEMO DATA.';

-- -----------------------------------------------------------------------------
-- Grants — Supabase exposes the `public` schema to `anon` / `authenticated`, so
-- make the read permission explicit for both engines.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'routes', 'route_stops', 'vehicle_snapshots', 'occupancy_predictions',
    'route_options', 'service_alerts', 'app_users'
  ]
  loop
    execute format('grant select on table %I to anon, authenticated', t);
    execute format('grant all on table %I to service_role', t);
  end loop;

  foreach t in array array['v_stops', 'v_vehicles', 'v_alerts', 'v_users']
  loop
    execute format('grant select on table %I to anon, authenticated, service_role', t);
  end loop;

  execute 'grant usage, select on sequence occupancy_predictions_id_seq to service_role';
end
$$;
