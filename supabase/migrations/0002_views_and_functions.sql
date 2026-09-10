-- =============================================================================
-- TransitPulse AI · 0002 · Derived views + database functions
-- =============================================================================
-- All analytical logic that benefits from running inside Postgres — schedules,
-- crowd baselines, operator rollups — lives here so the API layer stays thin
-- and the UI never computes transportation logic.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reusable scalar helpers
-- -----------------------------------------------------------------------------
-- Occupancy → crowd band. The same three bands are declared in
-- `shared/crowd.ts`, so Postgres and the UI can never disagree:
--   below 60% Low · 60–85% Moderate · above 85% High
create or replace function fn_crowd_level(p_ratio numeric)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_ratio, 0) > 0.85 then 'high'
    when p_ratio > 0.60 then 'moderate'
    else 'low'
  end;
$$;

-- Crowd penalty curve in **minute-equivalents**, mirroring the same curve in
-- `shared/crowd.ts`:
--   Route score = travel time + waiting time + crowd penalty
-- Low loads are nearly free, the penalty climbs steadily through the Moderate
-- band and rises steeply past 85% where a crush load costs more than a detour.
create or replace function fn_crowd_penalty_minutes(p_ratio numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_ratio, 0) <= 0 then 0
    when p_ratio <= 0.60 then round(p_ratio * 8, 3)
    when p_ratio <= 0.85 then round(4.8 + (p_ratio - 0.60) * 40, 3)
    else round(14.8 + power(p_ratio - 0.85, 1.35) * 120, 3)
  end;
$$;

-- -----------------------------------------------------------------------------
-- Timetable: minutes from line origin to each stop
-- -----------------------------------------------------------------------------
create or replace view v_line_stop_offsets as
with offsets as (
  select
    ls.line_id,
    ls.stop_id,
    ls.seq,
    coalesce(
      sum(ls.travel_minutes_from_prev) over (
        partition by ls.line_id order by ls.seq
        rows between unbounded preceding and 1 preceding
      ),
      0
    )::integer as offset_minutes,
    sum(ls.travel_minutes_from_prev) over (partition by ls.line_id)::integer as run_minutes
  from line_stops ls
)
select
  line_id,
  stop_id,
  seq,
  offset_minutes,
  count(*) over (partition by line_id)::integer as line_stop_count,
  run_minutes as line_total_minutes
from offsets;

-- -----------------------------------------------------------------------------
-- Crowd baselines learned from raw telemetry
-- -----------------------------------------------------------------------------
create or replace view v_line_hourly_profile as
select
  o.line_id,
  o.stop_id,
  o.day_type,
  o.hour_of_day,
  round(avg(o.occupancy_ratio), 3)                                     as avg_ratio,
  round(percentile_cont(0.9) within group (order by o.occupancy_ratio)::numeric, 3) as p90_ratio,
  round(max(o.occupancy_ratio), 3)                                     as max_ratio,
  count(*)::integer                                                    as sample_size,
  max(o.observed_at)                                                   as last_observed_at
from crowd_observations o
group by o.line_id, o.stop_id, o.day_type, o.hour_of_day;

-- Same shape, aggregated across every stop on the line (fallback baseline when
-- a specific stop/line pair has not been observed yet).
create or replace view v_line_hourly_profile_all_stops as
select
  o.line_id,
  o.day_type,
  o.hour_of_day,
  round(avg(o.occupancy_ratio), 3) as avg_ratio,
  round(percentile_cont(0.9) within group (order by o.occupancy_ratio)::numeric, 3) as p90_ratio,
  count(*)::integer                as sample_size
from crowd_observations o
group by o.line_id, o.day_type, o.hour_of_day;

create or replace view v_latest_crowd_reading as
select distinct on (o.line_id, o.stop_id)
  o.line_id,
  o.stop_id,
  o.observed_at,
  o.onboard_count,
  o.capacity,
  o.occupancy_ratio,
  o.source,
  fn_crowd_level(o.occupancy_ratio) as level
from crowd_observations o
order by o.line_id, o.stop_id, o.observed_at desc;

create or replace view v_line_crowding_now as
select
  r.line_id,
  l.code        as line_code,
  l.name        as line_name,
  l.color       as line_color,
  l.mode,
  s.id          as stop_id,
  s.name        as stop_name,
  r.observed_at,
  r.onboard_count,
  r.capacity,
  r.occupancy_ratio,
  r.level
from v_latest_crowd_reading r
join lines l on l.id = r.line_id
join stops s on s.id = r.stop_id;

-- -----------------------------------------------------------------------------
-- Timetable expansion: next departures from a stop
-- -----------------------------------------------------------------------------
create or replace function fn_next_departures(
  p_stop_id        text,
  p_from           timestamptz default now(),
  p_horizon_minutes integer  default 90
)
returns table (
  line_id          text,
  line_code        text,
  line_name        text,
  line_color       text,
  mode             text,
  direction        smallint,
  departure_at     timestamptz,
  offset_minutes   integer,
  headway_minutes  integer,
  vehicle_code     text,
  vehicle_capacity integer
)
language sql
stable
as $$
  with base as (
    select
      sp.id,
      sp.line_id,
      sp.direction,
      sp.headway_minutes,
      sp.first_departure,
      sp.last_departure,
      l.code,
      l.name,
      l.color,
      l.mode,
      a.timezone,
      o.offset_minutes,
      o.line_total_minutes,
      (p_from at time zone a.timezone) as local_now
    from service_patterns sp
    join lines l            on l.id = sp.line_id and l.is_active
    join agencies a         on a.id = l.agency_id
    join v_line_stop_offsets o on o.line_id = sp.line_id and o.stop_id = p_stop_id
    where sp.service_day = case
        when extract(isodow from (p_from at time zone a.timezone)) = 6 then 'saturday'
        when extract(isodow from (p_from at time zone a.timezone)) = 7 then 'sunday'
        else 'weekday'
      end
  ),
  expanded as (
    select
      b.*,
      -- Direction 1 runs the sequence backwards, so the run time to reach the
      -- stop is measured from the far terminus instead of the near one.
      case
        when b.direction = 1 then greatest(b.line_total_minutes - b.offset_minutes, 0)
        else b.offset_minutes
      end            as stop_offset_minutes,
      dep.t          as local_departure,
      dep.idx        as run_index
    from base b
    cross join lateral (
      select gs as t, (row_number() over (order by gs))::integer - 1 as idx
      from generate_series(
             date_trunc('day', b.local_now) + b.first_departure,
             date_trunc('day', b.local_now) + b.last_departure,
             make_interval(mins => b.headway_minutes)
           ) gs
      where gs >= b.local_now
        and gs <= b.local_now + make_interval(mins => p_horizon_minutes)
    ) dep
  )
  select
    e.line_id,
    e.code,
    e.name,
    e.color,
    e.mode,
    e.direction,
    (e.local_departure + make_interval(mins => e.stop_offset_minutes)) at time zone e.timezone
      as departure_at,
    e.stop_offset_minutes,
    e.headway_minutes,
    veh.code,
    veh.capacity_total
  from expanded e
  left join lateral (
    select v.code, v.capacity_total
    from vehicles v
    where v.line_id = e.line_id and v.status = 'in_service'
    order by v.code
    offset (
      case
        when (select count(*) from vehicles v2 where v2.line_id = e.line_id and v2.status = 'in_service') > 0
          then mod(
            e.run_index,
            (select count(*) from vehicles v2 where v2.line_id = e.line_id and v2.status = 'in_service')
          )
        else 0
      end
    )
    limit 1
  ) veh on true
  order by departure_at;
$$;

-- The ordered stops a rider passes through between two sequence positions,
-- with the running ETA (minutes) measured from the boarding stop.
create or replace function fn_line_segments(p_line_id text, p_from_seq integer, p_to_seq integer)
returns table (
  line_id       text,
  stop_id       text,
  stop_name     text,
  seq           integer,
  offset_minutes integer,
  eta_minutes   integer
)
language sql
stable
as $$
  select
    a.line_id,
    a.stop_id,
    s.name,
    a.seq,
    a.offset_minutes,
    abs(a.offset_minutes - base.offset_minutes)
  from v_line_stop_offsets a
  join v_line_stop_offsets base
    on base.line_id = a.line_id and base.seq = least(p_from_seq, p_to_seq)
  join stops s on s.id = a.stop_id
  where a.line_id = p_line_id
    and a.seq between least(p_from_seq, p_to_seq) and greatest(p_from_seq, p_to_seq)
  order by a.seq;
$$;

-- -----------------------------------------------------------------------------
-- Operator rollups
-- -----------------------------------------------------------------------------
create or replace view v_operator_line_load as
select
  o.line_id,
  o.day_type,
  o.hour_of_day,
  round(avg(o.occupancy_ratio), 3) as avg_ratio,
  round(max(o.occupancy_ratio), 3) as peak_ratio,
  count(*)::integer                as sample_size
from crowd_observations o
group by o.line_id, o.day_type, o.hour_of_day;

create or replace view v_network_summary as
select
  (select count(*) from stops)                       as stop_count,
  (select count(*) from stops where is_interchange)  as interchange_count,
  (select count(*) from lines where is_active)       as line_count,
  (select count(*) from line_stops)                  as connection_count,
  (select count(*) from vehicles where status = 'in_service') as vehicles_in_service,
  (select count(*) from crowd_observations)          as observation_count,
  (select count(*) from crowd_forecasts)             as forecast_count,
  (select count(*) from alerts where status = 'active') as active_alerts;

-- -----------------------------------------------------------------------------
-- Keep telemetry buckets consistent with the timestamp they describe.
-- -----------------------------------------------------------------------------
create or replace function fn_normalise_crowd_observation()
returns trigger
language plpgsql
as $$
declare
  v_zone text;
begin
  -- Buckets are stored as local hours in the **agency** timezone so that
  -- "hour 8" means 08:00 for riders — the same convention the crowd model uses
  -- when it looks up a baseline (`fractionalHour(at, agencyTimezone)`).
  -- Extracting the hour in the session timezone would silently shift every
  -- learned baseline by the UTC offset of the network (5h30m for Asia/Kolkata).
  select timezone into v_zone from agencies order by id limit 1;
  v_zone := coalesce(v_zone, 'UTC');

  new.day_type := case
    when extract(isodow from new.observed_at at time zone v_zone) = 6 then 'saturday'
    when extract(isodow from new.observed_at at time zone v_zone) = 7 then 'sunday'
    else 'weekday'
  end;
  new.hour_of_day := extract(hour from new.observed_at at time zone v_zone)::smallint;
  new.occupancy_ratio := round(new.onboard_count::numeric / nullif(new.capacity, 0), 3);
  return new;
end;
$$;

drop trigger if exists trg_normalise_crowd_observation on crowd_observations;
create trigger trg_normalise_crowd_observation
  before insert or update on crowd_observations
  for each row execute function fn_normalise_crowd_observation();
