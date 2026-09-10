-- =============================================================================
-- TransitPulse AI · seed 0004 · Canonical dataset (routes, stops, vehicles …)
-- =============================================================================
-- DEMO / SIMULATED DATA.
--
-- The canonical route-level dataset is *projected* from the network seeded by
-- 0001–0003 rather than typed in by hand, so the published tables always agree
-- with the telemetry, forecasts and planner output the app runs on:
--
--   routes (6)                  ← lines                    + stop sequences
--   route_stops (32)            ← line_stops + stops
--   vehicle_snapshots (24)      ← vehicles + live crowd readings
--   occupancy_predictions (72)  ← crowd_forecasts
--   route_options (24)          ← routes + planner weights + live crowding
--   service_alerts (10)         ← alerts
--   app_users (3)               ← rider_profiles (commuter, operator, admin)
-- =============================================================================

do $$
declare
  rec record;
begin
  for rec in select * from fn_refresh_demo_dataset() loop
    raise notice '[seed] canonical dataset · % → % rows', rec.dataset_table, rec.row_count;
  end loop;
end
$$;
