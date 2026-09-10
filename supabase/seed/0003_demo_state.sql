-- =============================================================================
-- TransitPulse AI · seed 0003 · Alerts, riders, saved journeys, demand history
-- =============================================================================
-- Everything the operator dashboard aggregates (route search demand, alert
-- reach) is generated here as real rows — the UI never invents these numbers.
-- =============================================================================

create or replace function fn_seed_noise(p_seed text)
returns numeric
language sql
immutable
as $$
  select (('x' || substr(md5(p_seed), 1, 15))::bit(60)::bigint % 100000)::numeric / 100000.0;
$$;

-- -----------------------------------------------------------------------------
-- Service alerts
-- -----------------------------------------------------------------------------
insert into alerts (id, agency_id, line_id, stop_id, severity, category, title, body,
                    starts_at, ends_at, status, issued_by, reach)
values
  ('ALT-1001', 'AG-MERIDIAN', 'LN-M1', 'STN-02', 'critical', 'disruption',
   'Signal failure at Meridian Junction',
   'Trains are running every 12 minutes between Central Exchange and Northgate while engineers replace a trackside signal. Expect platform crowding at Meridian Junction until service normalises.',
   now() - interval '48 minutes', now() + interval '2 hours 15 minutes', 'active', 'Control Room A', 41260),

  ('ALT-1002', 'AG-MERIDIAN', 'LN-M2', 'STN-01', 'major', 'crowding',
   'Crush load forecast: Central Exchange northbound',
   'TransitPulse predicts occupancy above 105% on northbound Blue Line services between 17:20 and 18:40. Consider boarding two services later or switching to the BR1 express at Tech Park North.',
   now() - interval '12 minutes', now() + interval '1 hour 40 minutes', 'active', 'TransitPulse AI', 18940),

  ('ALT-1003', 'AG-MERIDIAN', 'LN-B12', null, 'minor', 'delay',
   'Crosstown 12 running 4–7 minutes late',
   'Roadworks on the Greenfield corridor are delaying westbound services. Next departures from University are adjusted in the journey planner.',
   now() - interval '3 hours', now() + interval '4 hours', 'active', 'Operations Desk', 7210),

  ('ALT-1004', 'AG-MERIDIAN', 'LN-F2', null, 'major', 'weather',
   'Harbour Ferry suspended — heavy swell',
   'Cross-harbour ferry services are suspended until sea conditions improve. Replacement buses run from Ferry Terminal to Harbour Gate every 15 minutes.',
   now() - interval '1 hour 20 minutes', now() + interval '5 hours', 'active', 'Harbour Master', 3480),

  ('ALT-1005', 'AG-MERIDIAN', 'LN-T4', null, 'info', 'service_change',
   'Riverside Tram weekend timetable from Saturday',
   'Trams will run every 14 minutes on Saturdays and Sundays while track renewal works continue near Stadium. First tram leaves Ferry Terminal at 06:30.',
   now() + interval '1 day', now() + interval '9 days', 'scheduled', 'Service Planning', 0),

  ('ALT-1006', 'AG-MERIDIAN', 'LN-BR1', 'STN-13', 'minor', 'crowding',
   'Northgate boarding pressure this evening',
   'Expected occupancy above 85% on the 18:05 and 18:11 departures from Northgate because of the Northgate Arena event. Additional vehicle allocated.',
   now() - interval '25 minutes', now() + interval '3 hours', 'active', 'TransitPulse AI', 5640),

  ('ALT-1007', 'AG-MERIDIAN', 'LN-M2', null, 'info', 'maintenance',
   'Track inspection between Stadium and Market Square tonight',
   'Planned inspection from 01:00 to 04:00. The last scheduled service is unaffected; overnight replacement buses will operate.',
   now() + interval '6 hours', now() + interval '11 hours', 'scheduled', 'Engineering', 0),

  ('ALT-1008', 'AG-MERIDIAN', 'LN-M1', 'STN-08', 'minor', 'delay',
   'Market Square escalator works — resolved',
   'Escalator 3 at Market Square is back in service. Residual delays on the Red Line have cleared.',
   now() - interval '6 hours', now() - interval '2 hours', 'resolved', 'Station Team', 9980);

-- -----------------------------------------------------------------------------
-- Demo rider
-- -----------------------------------------------------------------------------
insert into rider_profiles (
  id, agency_id, display_name, email, home_stop_id, work_stop_id,
  crowd_tolerance, max_walk_minutes, max_transfers, preferred_modes,
  notify_push, notify_email, notify_sms, crowd_threshold_alert,
  quiet_hours_start, quiet_hours_end, theme, units, language, personalization_enabled
) values
  ('profile-ava', 'AG-MERIDIAN', 'Ava Chen', 'ava.chen@example.com', 'STN-12', 'STN-04',
   0.780, 12, 1, '{metro,tram,brt,bus}',
   true, true, false, 0.820,
   '22:30', '06:30', 'dark', 'metric', 'en', true),
  ('profile-ops', 'AG-MERIDIAN', 'Meridian Control', 'control@meridianmetro.example', 'STN-01', 'STN-01',
   1.050, 8, 2, '{metro,bus,tram,brt,ferry}',
   true, false, false, 0.900,
   null, null, 'midnight', 'metric', 'en', true);

insert into watchlist (id, profile_id, label, origin_stop_id, destination_stop_id, depart_time, days, avoid_crowded, notify) values
  ('WL-2001', 'profile-ava', 'Morning commute',   'STN-12', 'STN-04', '08:15', '{mon,tue,wed,thu,fri}', true,  true),
  ('WL-2002', 'profile-ava', 'Evening return',    'STN-04', 'STN-12', '18:20', '{mon,tue,wed,thu,fri}', true,  true),
  ('WL-2003', 'profile-ava', 'Saturday market',   'STN-12', 'STN-08', '10:30', '{sat}',                 true,  false),
  ('WL-2004', 'profile-ops', 'Airport transfer',  'STN-01', 'STN-11', null,    '{mon,tue,wed,thu,fri,sat,sun}', false, false);

-- -----------------------------------------------------------------------------
-- Historical route-search demand — feeds the operator "demand signals" panel
-- -----------------------------------------------------------------------------
with pairs (origin, destination, weight) as (
  values
    ('STN-12', 'STN-04', 1.00),
    ('STN-04', 'STN-12', 0.94),
    ('STN-01', 'STN-11', 0.86),
    ('STN-09', 'STN-01', 0.78),
    ('STN-16', 'STN-08', 0.61),
    ('STN-13', 'STN-01', 0.72),
    ('STN-15', 'STN-03', 0.55),
    ('STN-05', 'STN-02', 0.64),
    ('STN-11', 'STN-04', 0.49),
    ('STN-14', 'STN-08', 0.43)
),
days as (
  select generate_series(0, 13) as d
),
exploded as (
  select
    x.origin,
    x.destination,
    x.d,
    x.n,
    x.weight,
    x.roll,
    x.searched_at
  from (
    select
      p.origin,
      p.destination,
      d.d,
      g.n,
      p.weight,
      fn_seed_noise(p.origin || p.destination || d.d::text || g.n::text) as roll,
      date_trunc('day', now()) - make_interval(days => d.d)
        + make_interval(
            hours => case when fn_seed_noise(p.origin || p.destination || d.d::text || g.n::text) < 0.45
                          then 7 else 17 end,
            mins  => (fn_seed_noise(p.origin || p.destination || d.d::text || g.n::text) * 55)::integer
          ) as searched_at
    from pairs p
    cross join days d
    cross join lateral generate_series(
      1,
      greatest(1, round((4 + 8 * p.weight) * (1 - d.d * 0.035))::integer)
    ) as g(n)
  ) x
  -- today's demand only exists up to the current time
  where x.searched_at < now()
)
insert into route_searches (
  profile_id, origin_stop_id, destination_stop_id, depart_after,
  avoid_crowding, options_returned, recommended_option_id, chosen_option_id, created_at
)
select
  case when roll < 0.72 then 'profile-ava' else null end,
  origin,
  destination,
  searched_at,
  roll < 0.83,
  case when roll < 0.9 then 4 else 3 end,
  null,
  null,
  searched_at
from exploded;

-- Options for a subset of searches (older ones are stored without options to
-- keep the demo dataset lean).
insert into route_search_options (
  id, search_id, kind, total_minutes, transfers, crowd_risk, avg_crowd_ratio, score, crowding_avoided_pct, legs
)
select
  'rso-' || s.id || '-' || o.kind,
  s.id,
  o.kind,
  o.total_minutes,
  o.transfers,
  o.crowd_risk,
  o.avg_ratio,
  o.score,
  o.avoided,
  jsonb_build_array(
    jsonb_build_object(
      'kind', 'transit',
      'lineId', coalesce(l.id, ''),
      'fromStopId', s.origin_stop_id,
      'toStopId', s.destination_stop_id,
      'durationMinutes', o.total_minutes,
      'crowdRatio', o.avg_ratio
    )
  )
from route_searches s
cross join (values
  ('best',            1, 0),
  ('fastest',         0, 1),
  ('quietest',        1, 2),
  ('fewest_transfers',2, 3)
) as k(kind, idx, ord)
cross join lateral (
  select
    k.kind                                                                as kind,
    (18 + (s.id % 17) + k.idx * 4)::integer                               as total_minutes,
    case when k.kind = 'fewest_transfers' then 0
         when k.kind = 'quietest' then 1
         else (s.id % 2)::integer end                                     as transfers,
    round((0.38 + (s.id % 7) * 0.09 + k.idx * 0.07)::numeric, 3)          as crowd_risk,
    round((0.34 + (s.id % 5) * 0.07 + k.idx * 0.05)::numeric, 3)          as avg_ratio,
    round((40 + (s.id % 11) + k.idx * 5)::numeric, 3)                     as score,
    round((k.idx * 9.5 + (s.id % 4) * 1.75)::numeric, 2)                  as avoided
) as o
cross join lateral (
  select l2.id as id
  from lines l2
  order by (length(l2.code) + s.id + k.ord) % 6
  limit 1
) as l
where s.id % 3 = 0;

update route_searches s
set recommended_option_id = 'rso-' || s.id || '-quietest',
    chosen_option_id      = case when s.id % 4 = 0 then 'rso-' || s.id || '-fastest'
                                 else 'rso-' || s.id || '-quietest' end
where s.id % 3 = 0;

drop function if exists fn_seed_noise(text);
