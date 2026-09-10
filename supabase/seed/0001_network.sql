-- =============================================================================
-- TransitPulse AI · seed 0001 · Network topology
-- =============================================================================
-- A deterministic, self-consistent demo network for "Meridian City":
--   · 1 agency, 16 stops (5 interchanges), 6 lines across 5 modes
--   · Frequency-based timetable + 18 in-service vehicles
--   · Model/planner configuration rows consumed by the API layer
--
-- The loader is idempotent: it truncates and reloads the demo dataset.
-- =============================================================================

truncate table route_search_options, route_searches, watchlist, rider_profiles,
  crowd_forecasts, crowd_observations, vehicles, service_patterns, line_stops,
  lines, stops, alerts, agencies, model_config restart identity cascade;

-- -----------------------------------------------------------------------------
-- Agency
-- -----------------------------------------------------------------------------
insert into agencies (id, name, city, timezone) values
  ('AG-MERIDIAN', 'Meridian Metro Authority', 'Meridian City', 'UTC');

-- -----------------------------------------------------------------------------
-- Stops — interchange hubs carry the highest boarding volume
-- -----------------------------------------------------------------------------
insert into stops (id, agency_id, code, name, description, lat, lng, zone, is_interchange, daily_boardings) values
  ('STN-01', 'AG-MERIDIAN', 'CEX', 'Central Exchange',    'Primary downtown interchange and bus concourse.', 12.9716, 77.5946, 'Zone A', true,  48200),
  ('STN-02', 'AG-MERIDIAN', 'MJC', 'Meridian Junction',   'Northern rail + metro interchange.',              12.9960, 77.5946, 'Zone B', true,  31400),
  ('STN-03', 'AG-MERIDIAN', 'HBG', 'Harbour Gate',        'Harbour district terminus and ferry pier.',       12.9600, 77.6796, 'Zone C', true,  22600),
  ('STN-04', 'AG-MERIDIAN', 'TPN', 'Tech Park North',     'Technology corridor, campus shuttle hub.',        13.0060, 77.6096, 'Zone B', false, 19800),
  ('STN-05', 'AG-MERIDIAN', 'TPS', 'Tech Park South',     'Southern technology campus entrance.',            12.9910, 77.6196, 'Zone B', false, 15600),
  ('STN-06', 'AG-MERIDIAN', 'RVS', 'Riverside',           'Riverside promenade and riverside apartments.',   12.9766, 77.5646, 'Zone A', false, 12300),
  ('STN-07', 'AG-MERIDIAN', 'OTW', 'Old Town',            'Heritage quarter, weekend markets.',              12.9836, 77.5726, 'Zone A', false, 14100),
  ('STN-08', 'AG-MERIDIAN', 'MKS', 'Market Square',       'Retail core, major bus-to-metro interchange.',    12.9696, 77.5736, 'Zone A', true,  36700),
  ('STN-09', 'AG-MERIDIAN', 'UNI', 'University',          'University campus and student quarter.',          12.9646, 77.6146, 'Zone C', true,  27900),
  ('STN-10', 'AG-MERIDIAN', 'STD', 'Stadium',             'Stadium and events district.',                    12.9806, 77.6196, 'Zone C', false, 16400),
  ('STN-11', 'AG-MERIDIAN', 'APR', 'Airport Road',        'Airport approach, long-stay parking.',            12.9910, 77.6596, 'Zone D', false, 18900),
  ('STN-12', 'AG-MERIDIAN', 'GRF', 'Greenfield',          'Western suburbs, park and ride.',                 12.9576, 77.5496, 'Zone E', false,  9800),
  ('STN-13', 'AG-MERIDIAN', 'NGT', 'Northgate',           'Northern residential growth corridor.',           13.0196, 77.6196, 'Zone D', false, 11200),
  ('STN-14', 'AG-MERIDIAN', 'LKV', 'Lakeview',            'Lakeside residential district.',                  12.9506, 77.5646, 'Zone E', false,  8700),
  ('STN-15', 'AG-MERIDIAN', 'HSP', 'Hospital District',   'Regional hospital and medical campus.',           12.9456, 77.5846, 'Zone E', false, 13500),
  ('STN-16', 'AG-MERIDIAN', 'FRT', 'Ferry Terminal',      'Cross-harbour ferry terminal.',                   12.9486, 77.6996, 'Zone D', false,  7600);

-- -----------------------------------------------------------------------------
-- Lines
-- -----------------------------------------------------------------------------
insert into lines (id, agency_id, code, name, mode, color, capacity_per_vehicle, headway_minutes, is_active) values
  ('LN-M1', 'AG-MERIDIAN', 'M1',  'Red Line',            'metro', '#fb7185', 320, 4,  true),
  ('LN-M2', 'AG-MERIDIAN', 'M2',  'Blue Line',           'metro', '#38bdf8', 320, 5,  true),
  ('LN-B12','AG-MERIDIAN', 'B12', 'Crosstown 12',        'bus',   '#facc15',  86, 10, true),
  ('LN-T4', 'AG-MERIDIAN', 'T4',  'Riverside Tram',      'tram',  '#a78bfa', 180,  7, true),
  ('LN-BR1','AG-MERIDIAN', 'BR1', 'Harbour Express BRT', 'brt',   '#34d399', 110,  6, true),
  ('LN-F2', 'AG-MERIDIAN', 'F2',  'Harbour Ferry',       'ferry', '#22d3ee', 240, 20, true);

-- -----------------------------------------------------------------------------
-- Line stop sequences (seq 1..n, travel minutes from the previous stop)
-- -----------------------------------------------------------------------------
insert into line_stops (line_id, stop_id, seq, travel_minutes_from_prev) values
  -- M1 Red Line: Central Exchange → Northgate
  ('LN-M1', 'STN-01', 1, 0), ('LN-M1', 'STN-08', 2, 3), ('LN-M1', 'STN-07', 3, 4),
  ('LN-M1', 'STN-06', 4, 4), ('LN-M1', 'STN-02', 5, 5), ('LN-M1', 'STN-04', 6, 6),
  ('LN-M1', 'STN-13', 7, 5),
  -- M2 Blue Line: Harbour Gate → Airport Road
  ('LN-M2', 'STN-03', 1, 0), ('LN-M2', 'STN-10', 2, 4), ('LN-M2', 'STN-08', 3, 5),
  ('LN-M2', 'STN-01', 4, 3), ('LN-M2', 'STN-09', 5, 5), ('LN-M2', 'STN-05', 6, 4),
  ('LN-M2', 'STN-11', 7, 6),
  -- B12 Crosstown: Greenfield → Hospital District
  ('LN-B12','STN-12', 1, 0), ('LN-B12','STN-14', 2, 5), ('LN-B12','STN-09', 3, 7),
  ('LN-B12','STN-01', 4, 8), ('LN-B12','STN-07', 5, 4), ('LN-B12','STN-15', 6, 9),
  -- T4 Riverside Tram: Ferry Terminal → Stadium
  ('LN-T4', 'STN-16', 1, 0), ('LN-T4', 'STN-06', 2, 9), ('LN-T4', 'STN-08', 3, 5),
  ('LN-T4', 'STN-15', 4, 7), ('LN-T4', 'STN-10', 5, 6),
  -- BR1 Harbour Express BRT: Airport Road → Central Exchange
  ('LN-BR1','STN-11', 1, 0), ('LN-BR1','STN-04', 2, 6), ('LN-BR1','STN-13', 3, 5),
  ('LN-BR1','STN-02', 4, 6), ('LN-BR1','STN-01', 5, 5),
  -- F2 Harbour Ferry: Ferry Terminal → Harbour Gate
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
