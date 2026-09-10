-- =============================================================================
-- TransitPulse AI · seed 0001 · Network topology
-- =============================================================================
-- DEMO / SIMULATED DATA — not a real transit network.
--
-- A deterministic, self-consistent demo network modelled on an Indian city
-- corridor: 1 agency, 16 stops (5 interchanges), 6 routes across 5 modes,
-- Indian-style route numbering (M1, M2, 21G, T4, BR1, F2) and locality names.
-- Stop coordinates form a *simulated* grid over the city region — they are
-- illustrative, not surveyed positions.
--
--   · 16 stops (5 interchanges) and 6 lines across 5 modes
--   · Frequency-based timetable + 24 vehicles (18 in service)
--   · Model/planner configuration rows consumed by the API layer
--
-- The loader is idempotent: it truncates and reloads the demo dataset.
-- =============================================================================

truncate table route_search_options, route_searches, watchlist, rider_profiles,
  crowd_forecasts, crowd_observations, vehicles, service_patterns, line_stops,
  lines, stops, alerts, agencies, model_config restart identity cascade;

-- The canonical demo dataset (routes, route_stops, vehicle_snapshots,
-- occupancy_predictions, route_options, service_alerts, app_users) references
-- the tables above, so it is cleared here and rebuilt by seed 0004.
truncate table occupancy_predictions, route_options, service_alerts,
  vehicle_snapshots, route_stops, routes, app_users cascade;

-- -----------------------------------------------------------------------------
-- Agency
-- -----------------------------------------------------------------------------
insert into agencies (id, name, city, timezone) values
  ('AG-MERIDIAN', 'Chennai City Transit (DEMO)', 'Chennai', 'Asia/Kolkata');

-- -----------------------------------------------------------------------------
-- Stops — interchange hubs carry the highest boarding volume
-- -----------------------------------------------------------------------------
insert into stops (id, agency_id, code, name, description, lat, lng, zone, is_interchange, daily_boardings) values
  ('STN-01', 'AG-MERIDIAN', 'CEN', 'Chennai Central',  'Downtown interchange, suburban rail terminus and city bus hub.', 13.1216, 80.1946, 'Zone A', true,  48200),
  ('STN-02', 'AG-MERIDIAN', 'EGM', 'Egmore Junction',  'Rail and metro interchange serving the museum quarter.',         13.1460, 80.1946, 'Zone B', true,  31400),
  ('STN-03', 'AG-MERIDIAN', 'PRT', 'Chennai Port',     'Harbour district terminus and ferry pier.',                      13.1100, 80.2796, 'Zone C', true,  22600),
  ('STN-04', 'AG-MERIDIAN', 'TDL', 'Tidel Park',       'IT corridor, campus shuttle hub.',                               13.1560, 80.2096, 'Zone B', false, 19800),
  ('STN-05', 'AG-MERIDIAN', 'PER', 'Perungudi',        'Southern IT corridor entrance.',                                 13.1410, 80.2196, 'Zone B', false, 15600),
  ('STN-06', 'AG-MERIDIAN', 'ADY', 'Adyar',            'Riverfront promenade and riverside apartments.',                 13.1266, 80.1646, 'Zone A', false, 12300),
  ('STN-07', 'AG-MERIDIAN', 'MYP', 'Mylapore',         'Heritage temple quarter, weekend markets.',                      13.1336, 80.1726, 'Zone A', false, 14100),
  ('STN-08', 'AG-MERIDIAN', 'TNG', 'T. Nagar',         'Retail core, major bus-to-metro interchange.',                   13.1196, 80.1736, 'Zone A', true,  36700),
  ('STN-09', 'AG-MERIDIAN', 'ANU', 'Anna University',  'University campus and student quarter.',                         13.1146, 80.2146, 'Zone C', true,  27900),
  ('STN-10', 'AG-MERIDIAN', 'CHP', 'Chepauk',          'Cricket stadium and events district.',                           13.1306, 80.2196, 'Zone C', false, 16400),
  ('STN-11', 'AG-MERIDIAN', 'AIR', 'Chennai Airport',  'Airport approach, long-stay parking.',                           13.1410, 80.2596, 'Zone D', false, 18900),
  ('STN-12', 'AG-MERIDIAN', 'TBM', 'Tambaram',         'Southern suburban terminus, park and ride.',                     13.1076, 80.1496, 'Zone E', false,  9800),
  ('STN-13', 'AG-MERIDIAN', 'MDV', 'Madhavaram',       'Northern residential growth corridor.',                          13.1696, 80.2196, 'Zone D', false, 11200),
  ('STN-14', 'AG-MERIDIAN', 'VLR', 'Velachery',        'Lakeside residential district.',                                 13.1006, 80.1646, 'Zone E', false,  8700),
  ('STN-15', 'AG-MERIDIAN', 'KLP', 'Kilpauk',          'Medical campus district.',                                       13.0956, 80.1846, 'Zone E', false, 13500),
  ('STN-16', 'AG-MERIDIAN', 'ENR', 'Ennore Ferry Terminal', 'Cross-harbour ferry terminal.',                            13.0986, 80.2996, 'Zone D', false,  7600);

-- -----------------------------------------------------------------------------
-- Lines (Indian-style route numbers)
-- -----------------------------------------------------------------------------
insert into lines (id, agency_id, code, name, mode, color, capacity_per_vehicle, headway_minutes, is_active) values
  ('LN-M1', 'AG-MERIDIAN', 'M1',  'Metro Line 1 · Central – Madhavaram', 'metro', '#fb7185', 320, 4,  true),
  ('LN-M2', 'AG-MERIDIAN', 'M2',  'Metro Line 2 · Port – Airport',       'metro', '#38bdf8', 320, 5,  true),
  ('LN-B12','AG-MERIDIAN', '21G', 'MTC 21G · Tambaram – Kilpauk',        'bus',   '#facc15',  86, 10, true),
  ('LN-T4', 'AG-MERIDIAN', 'T4',  'Heritage Tram T4 · Ennore – Chepauk', 'tram',  '#a78bfa', 180,  7, true),
  ('LN-BR1','AG-MERIDIAN', 'BR1', 'BRT Corridor 1 · Airport – Central',  'brt',   '#34d399', 110,  6, true),
  ('LN-F2', 'AG-MERIDIAN', 'F2',  'Harbour Ferry · Ennore – Port',       'ferry', '#22d3ee', 240, 20, true);

-- -----------------------------------------------------------------------------
-- Line stop sequences (seq 1..n, travel minutes from the previous stop)
-- -----------------------------------------------------------------------------
insert into line_stops (line_id, stop_id, seq, travel_minutes_from_prev) values
  -- M1 Metro Line 1: Chennai Central → Madhavaram
  ('LN-M1', 'STN-01', 1, 0), ('LN-M1', 'STN-08', 2, 3), ('LN-M1', 'STN-07', 3, 4),
  ('LN-M1', 'STN-06', 4, 4), ('LN-M1', 'STN-02', 5, 5), ('LN-M1', 'STN-04', 6, 6),
  ('LN-M1', 'STN-13', 7, 5),
  -- M2 Metro Line 2: Chennai Port → Chennai Airport
  ('LN-M2', 'STN-03', 1, 0), ('LN-M2', 'STN-10', 2, 4), ('LN-M2', 'STN-08', 3, 5),
  ('LN-M2', 'STN-01', 4, 3), ('LN-M2', 'STN-09', 5, 5), ('LN-M2', 'STN-05', 6, 4),
  ('LN-M2', 'STN-11', 7, 6),
  -- 21G MTC bus: Tambaram → Kilpauk
  ('LN-B12','STN-12', 1, 0), ('LN-B12','STN-14', 2, 5), ('LN-B12','STN-09', 3, 7),
  ('LN-B12','STN-01', 4, 8), ('LN-B12','STN-07', 5, 4), ('LN-B12','STN-15', 6, 9),
  -- T4 Heritage Tram: Ennore → Chepauk
  ('LN-T4', 'STN-16', 1, 0), ('LN-T4', 'STN-06', 2, 9), ('LN-T4', 'STN-08', 3, 5),
  ('LN-T4', 'STN-15', 4, 7), ('LN-T4', 'STN-10', 5, 6),
  -- BR1 BRT corridor: Chennai Airport → Chennai Central
  ('LN-BR1','STN-11', 1, 0), ('LN-BR1','STN-04', 2, 6), ('LN-BR1','STN-13', 3, 5),
  ('LN-BR1','STN-02', 4, 6), ('LN-BR1','STN-01', 5, 5),
  -- F2 Harbour Ferry: Ennore → Chennai Port
  ('LN-F2', 'STN-16', 1, 0), ('LN-F2', 'STN-03', 2, 22);

-- -----------------------------------------------------------------------------
-- Frequency-based service patterns (both directions, all service days)
-- -----------------------------------------------------------------------------
insert into service_patterns (id, line_id, direction, service_day, first_departure, last_departure, headway_minutes, run_minutes)
select
  l.id || '-d' || d.direction || '-' || sd.day,
  l.id,
  d.direction,
  sd.day,
  case when sd.day = 'sunday' then time '06:30' else time '05:30' end,
  case when sd.day = 'sunday' then time '22:30' else time '23:30' end,
  case when sd.day = 'weekday' then l.headway_minutes else l.headway_minutes * 2 end,
  (select max(o.offset_minutes) + 2 from v_line_stop_offsets o where o.line_id = l.id)
from lines l
cross join (values (0::smallint), (1::smallint)) as d(direction)
cross join (values ('weekday'), ('saturday'), ('sunday')) as sd(day);

-- -----------------------------------------------------------------------------
-- Fleet
-- -----------------------------------------------------------------------------
insert into vehicles (id, line_id, code, capacity_seats, capacity_total, status, next_stop_id, adherence_pct, last_ping)
select
  'VEH-' || l.code || '-' || v.n,
  l.id,
  l.code || '-' || (100 + v.n),
  case l.mode
    when 'metro' then 60
    when 'brt'   then 44
    when 'tram'  then 56
    when 'ferry' then 180
    else 32
  end,
  l.capacity_per_vehicle,
  case
    when l.mode = 'ferry' and v.n = 3 then 'idle'
    when v.n = 4 then 'maintenance'
    else 'in_service'
  end,
  (
    select ls.stop_id
    from line_stops ls
    where ls.line_id = l.id
    order by ls.seq
    offset ((v.n - 1) % greatest((select count(*) from line_stops x where x.line_id = l.id), 1))
    limit 1
  ),
  -- Realistic adherence: rail-like modes stay within a minute or two, while one
  -- vehicle per road/tram/ferry line is running late, so the on-time KPI has a
  -- believable, explainable spread instead of a flat 100%.
  round((
    case
      when l.mode in ('metro', 'brt') then 96 + ((v.n * 3) % 4)
      when v.n = 2 then 90 + ((v.n * length(l.code)) % 4)
      else 95 + ((v.n * 2 + length(l.code)) % 4)
    end
  )::numeric, 2),
  now() - make_interval(mins => (v.n * 3) % 11)
from lines l
cross join (values (1), (2), (3), (4)) as v(n);

-- -----------------------------------------------------------------------------
-- Model + planner configuration (read by the API — never hardcoded in the UI)
-- -----------------------------------------------------------------------------
insert into model_config (key, value, description) values
  (
    'crowd_model',
    '{
      "version": "transitpulse-crowd-v3",
      "horizonMinutes": 120,
      "stepMinutes": 10,
      "confidenceFloor": 0.58,
      "baselineWindowDays": 14,
      "accuracy": 0.91,
      "features": [
        {"key": "hour_of_day",        "label": "Time-of-day demand curve",   "weight": 0.34},
        {"key": "stop_demand",        "label": "Stop boarding pressure",     "weight": 0.22},
        {"key": "service_frequency",  "label": "Headway / bunching",         "weight": 0.16},
        {"key": "day_type",           "label": "Weekday vs. weekend",        "weight": 0.12},
        {"key": "upstream_load",      "label": "Upstream occupancy carryover","weight": 0.10},
        {"key": "events_weather",     "label": "Events & weather",           "weight": 0.06}
      ]
    }'::jsonb,
    'Crowd forecasting model metadata, feature weights and horizon settings.'
  ),
  (
    'planner_weights',
    '{
      "time": 1.0,
      "crowd": 1.35,
      "transfer": 4.5,
      "walk": 1.6,
      "co2PerKmSavedKg": 0.121,
      "defaultFare": 2.4,
      "maxOptions": 4
    }'::jsonb,
    'Multi-objective weights for the recommendation engine (lower score wins).'
  ),
  (
    'service_targets',
    '{
      "onTimeTargetPct": 92,
      "crowdingThresholdRatio": 0.85,
      "responseSlaMinutes": 12
    }'::jsonb,
    'Operational targets that drive the operator dashboard KPIs.'
  );
