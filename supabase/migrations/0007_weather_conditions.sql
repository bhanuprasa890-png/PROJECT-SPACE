-- =============================================================================
-- TransitPulse AI · 0007 · Weather input for the prediction engine (SIMULATED)
-- =============================================================================
-- Weather is an **optional** input to the prediction pipeline:
--
--   Input Data → Prediction Engine → Occupancy Prediction
--              → Crowd Classification → Route Optimization
--
-- This migration adds `weather_conditions`, the table the Input Data stage
-- reads when the weather branch is enabled. Rows are **simulated demo data**
-- produced by `supabase/seed/0005_weather.sql` — a deterministic, monsoon-
-- flavoured Chennai pattern. Nothing here is a real forecast or measurement,
-- and no production accuracy is claimed.
--
-- The server can also synthesise slots in memory (`synthesiseWeather()` in
-- `server/services/prediction/weather.ts`) so the engine degrades gracefully if
-- this table is empty; either way the UI labels the source as simulated.
--
-- To move to a real feed later: implement `WeatherProvider` and hand it to the
-- engine. The table shape stays the same, only `source` changes.
-- =============================================================================

create table if not exists weather_conditions (
  id                text primary key,
  city              text        not null,
  observed_at       timestamptz not null,
  condition         text        not null
                    check (condition in ('clear', 'cloudy', 'light_rain',
                                         'heavy_rain', 'storm', 'heatwave')),
  severity          smallint    not null default 0
                    check (severity between 0 and 3),
  temperature_c     numeric(4,1)
                    check (temperature_c between -5 and 55),
  rainfall_mm       numeric(5,2) not null default 0
                    check (rainfall_mm >= 0),
  humidity_pct      smallint    check (humidity_pct between 0 and 100),
  wind_kph          numeric(4,1) check (wind_kph >= 0),
  summary           text        not null default '',
  -- 'simulated' for the demo seed; a real integration would insert 'external'.
  source            text        not null default 'simulated'
                    check (source in ('simulated', 'external')),
  created_at        timestamptz not null default now(),
  -- one observation per city per slot
  constraint weather_conditions_city_slot_key unique (city, observed_at)
);

comment on table weather_conditions is
  'DEMO / SIMULATED hourly weather slots used as the optional weather input of the prediction engine. Not a real forecast feed.';

create index if not exists idx_weather_conditions_observed_at
  on weather_conditions (observed_at desc);

create index if not exists idx_weather_conditions_city_observed_at
  on weather_conditions (city, observed_at);
