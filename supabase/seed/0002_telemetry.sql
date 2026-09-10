-- =============================================================================
-- TransitPulse AI · seed 0002 · Crowd telemetry + forecast history
-- =============================================================================
-- Generates a realistic 14-day occupancy history (two peaks per weekday,
-- flatter weekend curves, interchange stops busier than outlying stops) plus
-- a trailing high-frequency window so "live" panels always look fresh, and a
-- forward forecast grid written by the (simulated) crowd model.
--
-- Everything is deterministic: pseudo-randomness comes from md5 of the row key.
--
-- DEMO / SIMULATED DATA: the history below is generated, not measured. Hour
-- buckets are local hours in the agency timezone, so the learned baselines line
-- up with the timetable and with wall-clock time for the demo audience.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seed helpers (dropped again at the end of this file so the production schema
-- stays clean).
-- -----------------------------------------------------------------------------
create or replace function fn_seed_noise(p_seed text)
returns numeric
language sql
immutable
as $$
  select (
    ('x' || substr(md5(p_seed), 1, 15))::bit(60)::bigint % 100000
  )::numeric / 100000.0;
$$;

create or replace function fn_seed_hour_factor(p_hour integer, p_weekend boolean)
returns numeric
language sql
immutable
as $$
  select case
    when p_weekend then
      case p_hour
        when 5 then 0.34 when 6 then 0.42 when 7 then 0.50 when 8 then 0.56
        when 9 then 0.62 when 10 then 0.68 when 11 then 0.78 when 12 then 0.90
        when 13 then 0.96 when 14 then 0.92 when 15 then 0.90 when 16 then 0.96
        when 17 then 1.06 when 18 then 1.12 when 19 then 0.98 when 20 then 0.80
        when 21 then 0.62 when 22 then 0.46 else 0.32
      end
    else
      case p_hour
        when 5 then 0.40 when 6 then 0.62 when 7 then 1.00 when 8 then 1.26
        when 9 then 1.04 when 10 then 0.78 when 11 then 0.72 when 12 then 0.78
        when 13 then 0.82 when 14 then 0.74 when 15 then 0.80 when 16 then 0.94
        when 17 then 1.18 when 18 then 1.28 when 19 then 0.96 when 20 then 0.72
        when 21 then 0.56 when 22 then 0.44 else 0.32
      end
  end;
$$;

-- -----------------------------------------------------------------------------
-- 14 days of hourly telemetry for every line/stop pair
-- -----------------------------------------------------------------------------
insert into crowd_observations (
  line_id, stop_id, observed_at, day_type, hour_of_day,
  onboard_count, capacity, occupancy_ratio, source
)
with tz as (
  select timezone as zone from agencies order by id limit 1
),
grid as (
  select
    l.id                                        as line_id,
    o.stop_id,
    l.capacity_per_vehicle                      as capacity,
    l.mode,
    l.code                                      as line_code,
    s.is_interchange,
    s.daily_boardings,
    -- Wall-clock local time in the agency timezone, then converted back to an
    -- absolute instant: hour_of_day always matches the local hour of observed_at.
    (date_trunc('day', now() at time zone tz.zone)
      - make_interval(days => d.days)
      + make_interval(hours => h.hour))         as local_ts,
    h.hour                                      as hour_of_day,
    extract(isodow from (date_trunc('day', now() at time zone tz.zone)
      - make_interval(days => d.days))) in (6, 7) as weekend,
    tz.zone                                     as zone
  from lines l
  join v_line_stop_offsets o on o.line_id = l.id
  join stops s on s.id = o.stop_id
  cross join tz
  cross join generate_series(0, 14) as d(days)
  cross join generate_series(5, 23) as h(hour)
  where (date_trunc('day', now() at time zone tz.zone)
      - make_interval(days => d.days)
      + make_interval(hours => h.hour)) at time zone tz.zone
      < now() - interval '6 minutes'
),
scored as (
  select
    g.*,
    (case g.line_id
       when 'LN-M1'  then 0.56 when 'LN-M2'  then 0.50 when 'LN-B12' then 0.46
       when 'LN-T4'  then 0.42 when 'LN-BR1' then 0.48 else 0.34
     end)
    * fn_seed_hour_factor(g.hour_of_day, g.weekend)
    * (case when g.is_interchange then 1.16 else 1.0 end)
    * (0.82 + 0.36 * (g.daily_boardings::numeric / 48200.0))
    * (case g.mode when 'bus' then 1.08 when 'brt' then 1.02 when 'tram' then 0.95
                   when 'ferry' then 0.88 else 1.0 end)
    * (0.88 + 0.24 * fn_seed_noise(g.line_id || g.stop_id || g.local_ts::text))
      as raw_ratio,
    fn_seed_noise('src' || g.line_id || g.stop_id || g.local_ts::text) as source_roll
  from grid g
)
select
  line_id,
  stop_id,
  local_ts at time zone zone,
  case when extract(isodow from local_ts) in (6, 7) then 'saturday' else 'weekday' end,
  hour_of_day::smallint,
  greatest(1, round(greatest(0.06, least(1.32, raw_ratio)) * capacity))::integer,
  capacity,
  round(greatest(0.06, least(1.32, raw_ratio)), 3),
  case
    when source_roll < 0.62 then 'sensor'
    when source_roll < 0.86 then 'tap_reader'
    when source_roll < 0.95 then 'crew_report'
    else 'model'
  end
from scored;

-- -----------------------------------------------------------------------------
-- Trailing 10-minute telemetry window (keeps "live" views fresh at any hour)
-- -----------------------------------------------------------------------------
insert into crowd_observations (
  line_id, stop_id, observed_at, day_type, hour_of_day,
  onboard_count, capacity, occupancy_ratio, source
)
with tz as (
  select timezone as zone from agencies order by id limit 1
),
grid as (
  select
    l.id                                   as line_id,
    o.stop_id,
    l.capacity_per_vehicle                 as capacity,
    l.mode,
    s.is_interchange,
    s.daily_boardings,
    date_trunc('minute', now()) - make_interval(mins => k.steps * 10) as observed_at,
    extract(hour from (now() - make_interval(mins => k.steps * 10)) at time zone tz.zone)::integer as hour_of_day,
    extract(isodow from (now() at time zone tz.zone)) in (6, 7) as weekend
  from lines l
  join v_line_stop_offsets o on o.line_id = l.id
  join stops s on s.id = o.stop_id
  cross join tz
  cross join generate_series(0, 19) as k(steps)
),
scored as (
  select
    g.*,
    (case g.line_id
       when 'LN-M1'  then 0.56 when 'LN-M2'  then 0.50 when 'LN-B12' then 0.46
       when 'LN-T4'  then 0.42 when 'LN-BR1' then 0.48 else 0.34
     end)
    * fn_seed_hour_factor(g.hour_of_day, g.weekend)
    * (case when g.is_interchange then 1.16 else 1.0 end)
    * (0.82 + 0.36 * (g.daily_boardings::numeric / 48200.0))
    * (case g.mode when 'bus' then 1.08 when 'brt' then 1.02 when 'tram' then 0.95
                   when 'ferry' then 0.88 else 1.0 end)
    * (0.90 + 0.20 * fn_seed_noise(g.line_id || g.stop_id || g.observed_at::text))
      as raw_ratio
  from grid g
)
select
  line_id, stop_id, observed_at,
  case when weekend then 'saturday' else 'weekday' end,
  hour_of_day::smallint,
  greatest(1, round(greatest(0.06, least(1.32, raw_ratio)) * capacity))::integer,
  capacity,
  round(greatest(0.06, least(1.32, raw_ratio)), 3),
  case when fn_seed_noise('src' || line_id || stop_id || observed_at::text) < 0.7 then 'sensor' else 'tap_reader' end
from scored;

-- -----------------------------------------------------------------------------
-- Forward forecast grid written by the crowd model (next 3 hours, 15 min steps)
-- -----------------------------------------------------------------------------
insert into crowd_forecasts (
  line_id, stop_id, target_at, horizon_minutes, predicted_ratio, predicted_headcount,
  lower_ratio, upper_ratio, confidence, model_version, factors
)
with tz as (
  select timezone as zone from agencies order by id limit 1
),
grid as (
  select
    l.id                              as line_id,
    o.stop_id,
    l.capacity_per_vehicle            as capacity,
    l.mode,
    s.is_interchange,
    s.daily_boardings,
    l.code                            as line_code,
    date_trunc('minute', now()) + make_interval(mins => k.steps * 15) as target_at,
    k.steps * 15                      as horizon_minutes,
    extract(hour from (now() + make_interval(mins => k.steps * 15)) at time zone tz.zone)::integer as hour_of_day,
    extract(isodow from (now() at time zone tz.zone)) in (6, 7) as weekend
  from lines l
  join v_line_stop_offsets o on o.line_id = l.id
  join stops s on s.id = o.stop_id
  cross join tz
  cross join generate_series(1, 12) as k(steps)
),
scored as (
  select
    g.*,
    greatest(0.06, least(1.32,
      (case g.line_id
         when 'LN-M1'  then 0.56 when 'LN-M2'  then 0.50 when 'LN-B12' then 0.46
         when 'LN-T4'  then 0.42 when 'LN-BR1' then 0.48 else 0.34
       end)
      * fn_seed_hour_factor(g.hour_of_day, g.weekend)
      * (case when g.is_interchange then 1.16 else 1.0 end)
      * (0.82 + 0.36 * (g.daily_boardings::numeric / 48200.0))
      * (case g.mode when 'bus' then 1.08 when 'brt' then 1.02 when 'tram' then 0.95
                     when 'ferry' then 0.88 else 1.0 end)
      * (0.93 + 0.14 * fn_seed_noise('fc' || g.line_id || g.stop_id || g.target_at::text))
    )) as ratio
  from grid g
)
select
  line_id,
  stop_id,
  target_at,
  horizon_minutes,
  round(ratio, 3),
  greatest(1, round(ratio * capacity))::integer,
  round(greatest(0, ratio * (1 - 0.14 - horizon_minutes::numeric / 1200)), 3),
  round(least(2, ratio * (1 + 0.16 + horizon_minutes::numeric / 900)), 3),
  round(greatest(0.58, 0.96 - horizon_minutes::numeric * 0.0019), 3),
  'transitpulse-crowd-v3',
  jsonb_build_object(
    'hour_of_day', round(fn_seed_hour_factor(hour_of_day, weekend), 3),
    'stop_demand', round(0.82 + 0.36 * (daily_boardings::numeric / 48200.0), 3),
    'generated_by', 'seed'
  )
from scored;

drop function if exists fn_seed_noise(text);
drop function if exists fn_seed_hour_factor(integer, boolean);
