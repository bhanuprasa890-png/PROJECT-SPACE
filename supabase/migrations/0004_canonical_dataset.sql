-- =============================================================================
-- TransitPulse AI · 0004 · Canonical demo dataset (routes, stops, vehicles …)
-- =============================================================================
-- DEMO / SIMULATED DATA — every row in these tables is generated demo data.
-- Nothing here describes a real transit operator, vehicle or passenger.
--
-- Why these tables exist next to the network model
-- ------------------------------------------------
-- `lines`, `stops`, `vehicles`, `alerts` … are the high-fidelity *network*
-- model: shared stops between routes, per-stop travel times, frequency-based
-- timetables, raw telemetry. They power prediction and routing.
--
-- This migration adds the canonical, route-level dataset that a client,
-- analyst or BI tool consumes directly — the shape a small transit operator
-- would publish. It is a projection of the network model (see
-- `fn_refresh_demo_dataset()` in migration 0005), so it can never drift out of
-- sync and is never hand-edited.
--
-- Requested table            →  implemented as               (see also)
--   routes                   →  routes                       (1:1 with lines)
--   stops                    →  route_stops                  (v_stops)
--   vehicles                 →  vehicle_snapshots            (v_vehicles)
--   occupancy_predictions    →  occupancy_predictions
--   route_options            →  route_options
--   alerts                   →  service_alerts               (v_alerts)
--   users                    →  app_users                    (v_users)
--
-- `stops` / `vehicles` / `alerts` already exist as the network tables, so the
-- published shape is exposed under its requested name through the read-only
-- views in migration 0005 — a client that expects `stops(route_id, stop_name,
-- latitude, longitude, stop_order)` can read it straight from `v_stops`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- App user roles (commuter / operator / admin) live on the profile row
-- -----------------------------------------------------------------------------
alter table rider_profiles
  add column if not exists role text not null default 'commuter';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rider_profiles_role_check'
  ) then
    alter table rider_profiles
      add constraint rider_profiles_role_check
      check (role in ('commuter', 'operator', 'admin'));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 1. routes — one row per published route
-- -----------------------------------------------------------------------------
create table if not exists routes (
  id                         text primary key references lines (id) on delete cascade,
  route_number               text not null unique,
  route_name                 text not null,
  origin                     text not null,
  destination                text not null,
  estimated_duration_minutes integer not null check (estimated_duration_minutes between 1 and 600),
  active                     boolean not null default true,
  created_at                 timestamptz not null default now()
);

create index if not exists routes_active_idx on routes (active, route_number);
create index if not exists routes_origin_destination_idx on routes (origin, destination);

comment on table routes is
  'DEMO DATA · Published route list (projection of `lines`). One row per route with its endpoints and end-to-end duration.';

-- -----------------------------------------------------------------------------
-- 2. route_stops — the ordered stop list of each route
-- -----------------------------------------------------------------------------
-- Note: the network model shares stops between routes (interchanges), so the
-- per-route list is a distinct, owned table here — exactly what the requested
-- `stops(id, route_id, stop_name, latitude, longitude, stop_order)` describes.
create table if not exists route_stops (
  id         text primary key,
  route_id   text not null references routes (id) on delete cascade,
  stop_name  text not null,
  latitude   double precision not null check (latitude between -90 and 90),
  longitude  double precision not null check (longitude between -180 and 180),
  stop_order integer not null check (stop_order >= 1),
  created_at timestamptz not null default now(),
  constraint route_stops_route_order_key unique (route_id, stop_order),
  constraint route_stops_name_key unique (route_id, stop_name)
);

create index if not exists route_stops_route_order_idx on route_stops (route_id, stop_order);
create index if not exists route_stops_name_idx on route_stops (stop_name);
create index if not exists route_stops_geo_idx on route_stops (latitude, longitude);

comment on table route_stops is
  'DEMO DATA · Ordered stop list per route (the requested `stops` table; readable as `v_stops`).';
comment on column route_stops.stop_order is '1-based position of the stop along the route.';

-- -----------------------------------------------------------------------------
-- 3. vehicle_snapshots — live state of every vehicle in the demo fleet
-- -----------------------------------------------------------------------------
-- Distinct from `vehicles` (the fleet roster): this is the operational snapshot
-- a control room polls — where the vehicle is, how full it is and when that was
-- last observed.
create table if not exists vehicle_snapshots (
  id                text primary key references vehicles (id) on delete cascade,
  vehicle_number    text not null unique,
  route_id          text not null references routes (id) on delete cascade,
  capacity          integer not null check (capacity > 0),
  -- Occupancy may exceed design capacity during crush loads — that is exactly
  -- the condition TransitPulse warns about, so no upper bound is enforced.
  current_occupancy integer not null default 0 check (current_occupancy >= 0),
  status            text not null default 'in_service'
                    check (status in ('in_service', 'maintenance', 'idle', 'breakdown')),
  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  updated_at        timestamptz not null default now()
);

create index if not exists vehicle_snapshots_route_idx on vehicle_snapshots (route_id, status);
create index if not exists vehicle_snapshots_updated_idx on vehicle_snapshots (updated_at desc);
create index if not exists vehicle_snapshots_load_idx on vehicle_snapshots (route_id, current_occupancy desc);

comment on table vehicle_snapshots is
  'DEMO DATA · Operational snapshot per vehicle (the requested `vehicles` table; readable as `v_vehicles`).';
comment on column vehicle_snapshots.updated_at is 'When the position/occupancy snapshot was last observed.';

-- -----------------------------------------------------------------------------
-- 4. occupancy_predictions — model output per route and vehicle
-- -----------------------------------------------------------------------------
create table if not exists occupancy_predictions (
  id                             bigserial primary key,
  route_id                       text not null references routes (id) on delete cascade,
  vehicle_id                     text references vehicle_snapshots (id) on delete set null,
  prediction_time                timestamptz not null,
  predicted_occupancy_percentage numeric(5, 2) not null
                                 check (predicted_occupancy_percentage >= 0),
  crowd_level                    text not null
                                 check (crowd_level in ('low', 'moderate', 'high')),
  confidence_percentage          numeric(5, 2) not null
                                 check (confidence_percentage between 0 and 100),
  created_at                     timestamptz not null default now(),
  -- One route-level prediction per time slot: the worst-case load across the
  -- route's stops at that moment, which is what a rider actually experiences.
  constraint occupancy_predictions_route_slot_key unique (route_id, prediction_time)
);

create index if not exists occupancy_predictions_route_time_idx
  on occupancy_predictions (route_id, prediction_time desc);
create index if not exists occupancy_predictions_time_idx
  on occupancy_predictions (prediction_time desc);
create index if not exists occupancy_predictions_level_idx
  on occupancy_predictions (crowd_level, prediction_time desc);
create index if not exists occupancy_predictions_vehicle_idx
  on occupancy_predictions (vehicle_id, prediction_time desc);

comment on table occupancy_predictions is
  'DEMO DATA · Forecast occupancy per route/vehicle, produced by the crowd model from `crowd_forecasts`.';
comment on column occupancy_predictions.crowd_level is
  'Bucketed from the percentage with the shared three-band thresholds: <60 low, 60-85 moderate, above 85 high.';

-- -----------------------------------------------------------------------------
-- 5. route_options — scored itinerary alternatives per route
-- -----------------------------------------------------------------------------
create table if not exists route_options (
  id                   text primary key,
  route_id             text not null references routes (id) on delete cascade,
  travel_time_minutes  integer not null check (travel_time_minutes between 1 and 600),
  waiting_time_minutes integer not null default 0 check (waiting_time_minutes between 0 and 240),
  crowd_penalty        numeric(6, 3) not null default 0 check (crowd_penalty >= 0),
  total_score          numeric(8, 3) not null check (total_score >= 0),
  created_at           timestamptz not null default now()
);

create index if not exists route_options_route_score_idx on route_options (route_id, total_score);
create index if not exists route_options_score_idx on route_options (total_score);

comment on table route_options is
  'DEMO DATA · Scored alternatives per route (lower `total_score` wins). Mirrors the planner objective: time + waiting + crowd penalty.';

-- -----------------------------------------------------------------------------
-- 6. service_alerts — route-level rider notices
-- -----------------------------------------------------------------------------
create table if not exists service_alerts (
  id                      text primary key,
  route_id                text not null references routes (id) on delete cascade,
  alert_type              text not null check (alert_type in
                          ('crowding', 'delay', 'disruption', 'service_change', 'weather', 'maintenance')),
  message                 text not null,
  severity                text not null check (severity in ('info', 'minor', 'major', 'critical')),
  predicted_occupancy     numeric(5, 2) check (predicted_occupancy is null or predicted_occupancy >= 0),
  estimated_time_to_event integer check (estimated_time_to_event is null or estimated_time_to_event >= 0),
  active                  boolean not null default true,
  created_at              timestamptz not null default now()
);

create index if not exists service_alerts_route_idx on service_alerts (route_id, active, severity);
create index if not exists service_alerts_active_idx on service_alerts (active, created_at desc);
create index if not exists service_alerts_severity_idx on service_alerts (severity, created_at desc);

comment on table service_alerts is
  'DEMO DATA · Route-level rider notices (the requested `alerts` table; readable as `v_alerts`).';
comment on column service_alerts.estimated_time_to_event is
  'Minutes from `created_at` until the predicted event (delay end, crowding onset, works start). Null when unknown.';

-- -----------------------------------------------------------------------------
-- 7. app_users — commuters, operators and admins
-- -----------------------------------------------------------------------------
create table if not exists app_users (
  id         text primary key references rider_profiles (id) on delete cascade,
  name       text not null,
  email      text not null unique,
  role       text not null default 'commuter' check (role in ('commuter', 'operator', 'admin')),
  created_at timestamptz not null default now()
);

create index if not exists app_users_role_idx on app_users (role);
create index if not exists app_users_email_idx on app_users (lower(email));

comment on table app_users is
  'DEMO DATA · Application users and their role (the requested `users` table; readable as `v_users`). Supabase Auth owns credentials — this table holds profile, role and contact details only.';

-- -----------------------------------------------------------------------------
-- Row Level Security — published demo data is public read-only
-- -----------------------------------------------------------------------------
alter table routes                enable row level security;
alter table route_stops           enable row level security;
alter table vehicle_snapshots     enable row level security;
alter table occupancy_predictions enable row level security;
alter table route_options         enable row level security;
alter table service_alerts        enable row level security;
alter table app_users             enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'routes', 'route_stops', 'vehicle_snapshots', 'occupancy_predictions',
    'route_options', 'service_alerts'
  ]
  loop
    execute format('drop policy if exists "%s_public_read" on %I', t, t);
    execute format(
      'create policy "%s_public_read" on %I for select to anon, authenticated using (true)',
      t, t
    );
  end loop;
end
$$;

-- Only operators/admins may publish or change notices; riders may read them.
drop policy if exists "service_alerts_staff_write" on service_alerts;
create policy "service_alerts_staff_write" on service_alerts
  for all to authenticated
  using (coalesce((auth.role()), '') = 'service_role')
  with check (coalesce((auth.role()), '') = 'service_role');

-- `app_users` rows are private: a user may read only their own profile unless
-- they are calling with the service role (the Express API).
drop policy if exists "app_users_self_read" on app_users;
create policy "app_users_self_read" on app_users
  for select to authenticated
  using (
    id = (select auth.uid())::text
    or coalesce((auth.role()), '') = 'service_role'
  );
