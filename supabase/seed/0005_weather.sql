-- =============================================================================
-- TransitPulse AI · seed 0005 · Simulated weather slots (optional model input)
-- =============================================================================
-- DEMO / SIMULATED DATA — this is NOT a weather forecast.
--
-- 72 hourly slots (6 hours of history, 66 hours ahead) for the demo city,
-- generated deterministically from the slot timestamp so every reset produces
-- the same pattern. The shape is a plausible Chennai monsoon day: humid
-- mornings, a hot midday, and an evening shower window between 16:00 and 21:00
-- with occasional storms. `server/services/prediction/weather.ts` turns each
-- condition into a transparent **demand multiplier** (an assumption of the
-- prototype, not a measured effect) and the prediction engine applies it as one
-- input among historical occupancy, time of day, route, current occupancy,
-- day type and (optionally) this weather factor.
-- =============================================================================

insert into weather_conditions (
  id, city, observed_at, condition, severity, temperature_c,
  rainfall_mm, humidity_pct, wind_kph, summary, source
)
select
  'WX-' || to_char(s.observed_at at time zone 'Asia/Kolkata', 'YYYYMMDDHH24'),
  'Chennai (simulated)',
  s.observed_at,
  s.condition,
  case s.condition
    when 'clear' then 0 when 'cloudy' then 0
    when 'light_rain' then 1 when 'heatwave' then 2
    when 'heavy_rain' then 2 else 3
  end::smallint,
  case s.condition
    when 'heatwave' then 41.0 + round(s.r * 2, 1)
    when 'storm' then 26.5 - round(s.r * 1.5, 1)
    when 'heavy_rain' then 27.5 - round(s.r, 1)
    when 'light_rain' then 29.0 - round(s.r, 1)
    when 'cloudy' then 30.5 - round(s.r, 1)
    else 31.0 + round(s.r * 3, 1)
  end,
  case s.condition
    when 'storm' then 22.0 + round(s.r * 18, 2)
    when 'heavy_rain' then 9.0 + round(s.r * 9, 2)
    when 'light_rain' then 0.6 + round(s.r * 3, 2)
    else 0
  end,
  case s.condition
    when 'storm' then 92
    when 'heavy_rain' then 88
    when 'light_rain' then 82
    when 'cloudy' then 74
    when 'heatwave' then 46
    else 58
  end,
  case s.condition
    when 'storm' then 44.0 + round(s.r * 12, 1)
    when 'heavy_rain' then 26.0 + round(s.r * 10, 1)
    when 'light_rain' then 14.0 + round(s.r * 8, 1)
    when 'cloudy' then 11.0 + round(s.r * 6, 1)
    else 7.0 + round(s.r * 6, 1)
  end,
  case s.condition
    when 'clear' then 'Clear skies'
    when 'cloudy' then 'Cloudy'
    when 'light_rain' then 'Light showers'
    when 'heavy_rain' then 'Heavy rain band'
    when 'storm' then 'Thunderstorm'
    else 'Heatwave conditions'
  end,
  'simulated'
from (
  select
    gs as observed_at,
    extract(hour from (gs at time zone 'Asia/Kolkata'))::int as local_hour,
    h.r as r,
    case
      -- Monsoon bands: convective showers peak through the evening commute.
      when h.r < 0.03
           and extract(hour from (gs at time zone 'Asia/Kolkata')) between 15 and 20 then 'storm'
      when h.r < 0.10 then 'heavy_rain'
      when h.r < 0.24 then 'light_rain'
      when h.r < 0.47 then 'cloudy'
      when h.r > 0.94
           and extract(hour from (gs at time zone 'Asia/Kolkata')) between 12 and 15 then 'heatwave'
      else 'clear'
    end as condition
  from generate_series(
    date_trunc('hour', now()) - interval '6 hours',
    date_trunc('hour', now()) + interval '65 hours',
    interval '1 hour'
  ) as gs
  -- Deterministic 0..1 roll per (city, slot): no random(), same pattern after
  -- every reset. Inlined because the seed helpers are dropped when they finish.
  cross join lateral (
    select ((('x' || substr(md5('transitpulse-weather-' ||
             to_char(gs at time zone 'Asia/Kolkata', 'YYYY-MM-DD-HH24')), 1, 15))::bit(60)::bigint % 100000)::numeric / 100000.0) as r
  ) as h
) as s
on conflict (city, observed_at) do update set
  condition     = excluded.condition,
  severity      = excluded.severity,
  temperature_c = excluded.temperature_c,
  rainfall_mm   = excluded.rainfall_mm,
  humidity_pct  = excluded.humidity_pct,
  wind_kph      = excluded.wind_kph,
  summary       = excluded.summary,
  source        = excluded.source;

do $$
declare
  total integer;
  now_slot text;
begin
  select count(*), (select condition from weather_conditions
                     where observed_at <= now() order by observed_at desc limit 1)
    into total, now_slot
    from weather_conditions;
  raise notice '[seed] weather_conditions · % simulated slots · current: %', total, now_slot;
end
$$;
