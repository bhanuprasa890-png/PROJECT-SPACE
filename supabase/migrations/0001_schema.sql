-- =============================================================================
-- TransitPulse AI · 0001 · Core schema
-- =============================================================================
-- Target: Supabase Postgres (Postgres 15+) — also applied verbatim to the
-- embedded demo database so both engines share one source of truth.
--
-- Domain model
--   agencies ─┬─ stops ─────── line_stops ─── lines ─┬─ service_patterns
--             │                                      ├─ vehicles
--             └─ alerts                              └─ crowd_observations
--                                                        crowd_forecasts
--   rider_profiles ─┬─ watchlist
--                   └─ route_searches ── route_search_options
-- =============================================================================

create table if not exists schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now(),
  checksum    text
);

-- -----------------------------------------------------------------------------
-- Network topology
-- -----------------------------------------------------------------------------
create table if not exists agencies (
  id          text primary key,
  name        text not null,
  city        text not null,
  timezone    text not null default 'UTC',
  created_at  timestamptz not null default now()
);

create table if not exists stops (
  id               text primary key,
  agency_id        text not null references agencies (id) on delete cascade,
  code             text not null unique,
  name             text not null,
  description      text,
  lat              double precision not null check (lat between -90 and 90),
  lng              double precision not null check (lng between -180 and 180),
  zone             text,
  is_interchange   boolean not null default false,
  daily_boardings  integer not null default 0 check (daily_boardings >= 0),
  created_at       timestamptz not null default now()
);

create index if not exists stops_agency_idx on stops (agency_id);
create index if not exists stops_name_idx on stops using gin (to_tsvector('simple', name));

create table if not exists lines (
  id                   text primary key,
  agency_id            text not null references agencies (id) on delete cascade,
  code                 text not null unique,
  name                 text not null,
  mode                 text not null check (mode in ('metro', 'bus', 'tram', 'brt', 'ferry')),
  color                text not null default '#38bdf8',
  capacity_per_vehicle integer not null default 90 check (capacity_per_vehicle > 0),
  headway_minutes      integer not null default 8 check (headway_minutes > 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now()
);

create index if not exists lines_mode_idx on lines (mode);

create table if not exists line_stops (
  line_id                   text not null references lines (id) on delete cascade,
  stop_id                   text not null references stops (id) on delete cascade,
  seq                       integer not null check (seq >= 1),
  travel_minutes_from_prev  integer not null default 2 check (travel_minutes_from_prev >= 0),
  primary key (line_id, seq)
);

create unique index if not exists line_stops_line_stop_key on line_stops (line_id, stop_id);
create index if not exists line_stops_stop_idx on line_stops (stop_id);

-- Frequency-based timetable (GTFS `frequencies` style) — keeps the seed compact
-- while still allowing departure generation in SQL.
create table if not exists service_patterns (
  id                text primary key,
  line_id           text not null references lines (id) on delete cascade,
  direction         smallint not null default 0 check (direction in (0, 1)),
  service_day       text not null default 'weekday'
                    check (service_day in ('weekday', 'saturday', 'sunday')),
  first_departure   time not null default '05:30',
  last_departure    time not null default '23:30',
  headway_minutes   integer not null default 8 check (headway_minutes between 1 and 120),
  run_minutes       integer not null default 30,
  created_at        timestamptz not null default now(),
  unique (line_id, direction, service_day)
);

create table if not exists vehicles (
  id                text primary key,
  line_id           text not null references lines (id) on delete cascade,
  code              text not null unique,
  capacity_seats    integer not null default 40,
  capacity_total    integer not null default 90 check (capacity_total > 0),
  status            text not null default 'in_service'
                    check (status in ('in_service', 'maintenance', 'idle')),
  next_stop_id      text references stops (id) on delete set null,
  adherence_pct     numeric(5, 2) not null default 100,
  last_ping         timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists vehicles_line_idx on vehicles (line_id, status);

-- -----------------------------------------------------------------------------
-- Crowd telemetry + model output
-- -----------------------------------------------------------------------------
create table if not exists crowd_observations (
  id             bigserial primary key,
  line_id        text not null references lines (id) on delete cascade,
  stop_id        text not null references stops (id) on delete cascade,
  observed_at    timestamptz not null,
  day_type       text not null default 'weekday'
                 check (day_type in ('weekday', 'saturday', 'sunday')),
  hour_of_day    smallint not null check (hour_of_day between 0 and 23),
  onboard_count  integer not null check (onboard_count >= 0),
  capacity       integer not null check (capacity > 0),
  occupancy_ratio numeric(5, 3) not null check (occupancy_ratio >= 0),
  source         text not null default 'sensor'
                 check (source in ('sensor', 'tap_reader', 'crew_report', 'model')),
  created_at     timestamptz not null default now()
);

create index if not exists crowd_obs_line_time_idx on crowd_observations (line_id, observed_at desc);
create index if not exists crowd_obs_line_stop_hour_idx
  on crowd_observations (line_id, stop_id, day_type, hour_of_day);
create index if not exists crowd_obs_time_idx on crowd_observations (observed_at desc);

create table if not exists crowd_forecasts (
  id                  bigserial primary key,
  line_id             text not null references lines (id) on delete cascade,
  stop_id             text not null references stops (id) on delete cascade,
  target_at           timestamptz not null,
  horizon_minutes     integer not null check (horizon_minutes >= 0),
  predicted_ratio     numeric(5, 3) not null check (predicted_ratio >= 0),
  predicted_headcount integer not null check (predicted_headcount >= 0),
  lower_ratio         numeric(5, 3),
  upper_ratio         numeric(5, 3),
  confidence          numeric(4, 3) not null check (confidence between 0 and 1),
  model_version       text not null default 'transitpulse-crowd-v1',
  factors             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  unique (line_id, stop_id, target_at, model_version)
);

create index if not exists crowd_forecasts_lookup_idx
  on crowd_forecasts (line_id, stop_id, target_at);
create index if not exists crowd_forecasts_target_idx on crowd_forecasts (target_at);

-- -----------------------------------------------------------------------------
-- Service alerts
-- -----------------------------------------------------------------------------
create table if not exists alerts (
  id          text primary key,
  agency_id   text not null references agencies (id) on delete cascade,
  line_id     text references lines (id) on delete cascade,
  stop_id     text references stops (id) on delete cascade,
  severity    text not null check (severity in ('info', 'minor', 'major', 'critical')),
  category    text not null check (category in
                ('crowding', 'delay', 'disruption', 'service_change', 'weather', 'maintenance')),
  title       text not null,
  body        text not null,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  status      text not null default 'active' check (status in ('active', 'scheduled', 'resolved')),
  issued_by   text,
  reach       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists alerts_status_idx on alerts (status, starts_at desc);
create index if not exists alerts_line_idx on alerts (line_id, status);

-- -----------------------------------------------------------------------------
-- Riders
-- -----------------------------------------------------------------------------
create table if not exists rider_profiles (
  id                        text primary key,
  agency_id                 text not null references agencies (id) on delete cascade,
  auth_user_id              uuid,
  display_name              text not null,
  email                     text not null,
  home_stop_id              text references stops (id) on delete set null,
  work_stop_id              text references stops (id) on delete set null,
  crowd_tolerance           numeric(4, 3) not null default 0.800
                            check (crowd_tolerance between 0 and 2),
  max_walk_minutes          integer not null default 12 check (max_walk_minutes between 0 and 60),
  max_transfers             integer not null default 1 check (max_transfers between 0 and 4),
  preferred_modes           text[] not null default '{metro,bus,tram,brt,ferry}',
  notify_push               boolean not null default true,
  notify_email              boolean not null default false,
  notify_sms                boolean not null default false,
  crowd_threshold_alert     numeric(4, 3) not null default 0.850,
  quiet_hours_start         time,
  quiet_hours_end           time,
  theme                     text not null default 'dark' check (theme in ('dark', 'midnight', 'system')),
  units                     text not null default 'metric' check (units in ('metric', 'imperial')),
  language                  text not null default 'en',
  personalization_enabled   boolean not null default true,
  created_at                timestamptz not null default now()
);

create unique index if not exists rider_profiles_email_key on rider_profiles (email);
create unique index if not exists rider_profiles_auth_user_key
  on rider_profiles (auth_user_id) where auth_user_id is not null;

create table if not exists watchlist (
  id                  text primary key,
  profile_id          text not null references rider_profiles (id) on delete cascade,
  label               text not null,
  origin_stop_id      text not null references stops (id) on delete cascade,
  destination_stop_id text not null references stops (id) on delete cascade,
  depart_time         time,
  days                text[] not null default '{mon,tue,wed,thu,fri}',
  avoid_crowded       boolean not null default true,
  notify              boolean not null default true,
  created_at          timestamptz not null default now()
);

create index if not exists watchlist_profile_idx on watchlist (profile_id, created_at desc);

create table if not exists route_searches (
  id                     bigserial primary key,
  profile_id             text references rider_profiles (id) on delete set null,
  origin_stop_id         text not null references stops (id) on delete cascade,
  destination_stop_id    text not null references stops (id) on delete cascade,
  depart_after           timestamptz not null default now(),
  avoid_crowding         boolean not null default true,
  options_returned       integer not null default 0,
  recommended_option_id  text,
  chosen_option_id       text,
  created_at             timestamptz not null default now()
);

create index if not exists route_searches_od_idx
  on route_searches (origin_stop_id, destination_stop_id, created_at desc);
create index if not exists route_searches_profile_idx on route_searches (profile_id, created_at desc);

create table if not exists route_search_options (
  id                       text primary key,
  search_id                bigint not null references route_searches (id) on delete cascade,
  kind                     text not null
                           check (kind in ('best', 'fastest', 'quietest', 'fewest_transfers')),
  total_minutes            integer not null,
  transfers                integer not null default 0,
  crowd_risk               numeric(5, 3) not null,
  avg_crowd_ratio          numeric(5, 3) not null,
  score                    numeric(7, 3) not null,
  crowding_avoided_pct     numeric(5, 2) not null default 0,
  legs                     jsonb not null default '[]'::jsonb,
  created_at               timestamptz not null default now()
);

create index if not exists route_search_options_search_idx on route_search_options (search_id);

-- -----------------------------------------------------------------------------
-- Model + planner configuration (kept in the database, not in the UI)
-- -----------------------------------------------------------------------------
create table if not exists model_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

comment on table crowd_observations is
  'Raw per-stop occupancy telemetry (sensors, tap readers, crew reports).';
comment on table crowd_forecasts is
  'Persisted output of the TransitPulse crowd model, keyed by line/stop/target time.';
