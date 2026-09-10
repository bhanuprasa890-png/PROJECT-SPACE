-- =============================================================================
-- TransitPulse AI · seed 0006 · AI intervention ledger
-- =============================================================================
-- DEMO / SIMULATED DATA — not a real transit network.
--
-- Two interventions applied from the Operator Command Center on earlier service
-- days, so the ledger and the "recent interventions" strip are never empty and
-- judges can see the full lifecycle: detection → numbered actions → applied
-- record → alert → vehicle moved into service.
--
--   AID-0001  Metro Line 2, yesterday 18:00 IST evening peak   3 actions
--   AID-0002  MTC 21G, two days ago 08:15 IST morning peak     2 actions
--
-- Both rows satisfy the ledger constraints from migration 0008: the projected
-- occupancy is never worse than the forecast and every applied decision carries
-- an applied_at, an alert and (where a vehicle was deployed) a vehicle.
--
-- The matching alerts are already resolved — they happened on earlier service
-- days, so they must not inflate today's open-notice counts.
--
-- One statement on purpose: the alerts, decisions and actions are written by
-- data-modifying CTEs, so the whole ledger loads atomically and re-running the
-- seed set is a no-op (`on conflict do nothing`).
-- =============================================================================

with days as (
  select
    ((date_trunc('day', now() at time zone 'Asia/Kolkata')) - interval '1 day')  as yesterday,
    ((date_trunc('day', now() at time zone 'Asia/Kolkata')) - interval '2 days') as two_days_ago
),
moments as (
  select
    ((yesterday + interval '18 hours') at time zone 'Asia/Kolkata')             as m2_target,
    ((yesterday + interval '17 hours 45 minutes') at time zone 'Asia/Kolkata')  as m2_detected,
    ((yesterday + interval '17 hours 48 minutes') at time zone 'Asia/Kolkata')  as m2_applied,
    ((two_days_ago + interval '8 hours 15 minutes') at time zone 'Asia/Kolkata') as b12_target,
    ((two_days_ago + interval '8 hours') at time zone 'Asia/Kolkata')           as b12_detected,
    ((two_days_ago + interval '8 hours 4 minutes') at time zone 'Asia/Kolkata') as b12_applied
  from days
),
/* -- the two rider-facing alerts raised when the interventions were applied -- */
alert_rows as (
  insert into alerts (id, agency_id, line_id, stop_id, severity, category, title, body,
                      starts_at, ends_at, status, issued_by, reach)
  select v.id, 'AG-MERIDIAN', v.line_id, v.stop_id, 'major', 'crowding', v.title, v.body,
         v.starts_at, v.ends_at, 'resolved', 'TransitPulse AI', v.reach
  from moments m
  cross join lateral (
    values
      ('ALT-1011', 'LN-M2', 'STN-03',
       'AI intervention applied: Metro Line 2 · Port – Airport',
       'TransitPulse AI detected 94% predicted occupancy at Chennai Port for the 18:00 evening peak and applied three actions: one additional vehicle (M2-104), passengers redirected to BRT Corridor 1 at Tidel Park and a rider advisory. Projected occupancy after intervention: 62%. SIMULATED PROJECTION — the demo dataset is synthetic.',
       m.m2_applied, m.m2_target + interval '40 minutes', 21450),
      ('ALT-1012', 'LN-B12', 'STN-12',
       'AI intervention applied: MTC 21G · Tambaram – Kilpauk',
       'TransitPulse AI detected 91% predicted occupancy at Tambaram for the 08:15 morning peak and applied two actions: one additional vehicle (21G-104) and a rider advisory. Projected occupancy after intervention: 64%. SIMULATED PROJECTION — the demo dataset is synthetic.',
       m.b12_applied, m.b12_target + interval '30 minutes', 11820)
  ) as v(id, line_id, stop_id, title, body, starts_at, ends_at, reach)
  on conflict (id) do nothing
  returning id
),
/* -- the decisions themselves ------------------------------------------------ */
decision_rows as (
  insert into ai_decisions (id, agency_id, line_id, stop_id, status, basis, detected_at,
                            applied_at, target_at, horizon_minutes, minutes_to_congestion,
                            current_ratio, predicted_ratio, projected_ratio, threshold_ratio,
                            confidence, headcount, capacity, vehicles_in_service, method,
                            model_version, vehicle_id, alert_id, applied_by, note, simulated)
  select v.id, 'AG-MERIDIAN', v.line_id, v.stop_id, 'applied', 'forecast', v.detected_at,
         v.applied_at, v.target_at, 15, 15, v.current_ratio, v.predicted_ratio,
         v.projected_ratio, 0.850, v.confidence, v.headcount, v.capacity, v.vehicles_in_service,
         'sequential multiplicative relief — each action removes a share of the remaining peak load',
         'transitpulse-crowd-v3', v.vehicle_id, v.alert_id,
         'TransitPulse AI · Control Room A', v.note, true
  from moments m
  cross join lateral (
    values
      ('AID-0001', 'LN-M2', 'STN-03', m.m2_detected, m.m2_applied, m.m2_target,
       0.710::numeric, 0.940::numeric, 0.622::numeric, 0.880::numeric, 301, 320, 4,
       'VEH-M2-4', 'ALT-1011',
       'Evening peak at Chennai Port. One maintenance unit was released for the peak and returned to the depot overnight.'),
      ('AID-0002', 'LN-B12', 'STN-12', m.b12_detected, m.b12_applied, m.b12_target,
       0.680, 0.910, 0.642, 0.860, 78, 86, 3,
       'VEH-21G-4', 'ALT-1012',
       'Morning peak at Tambaram. Standby bus released from the depot for two round trips.')
  ) as v(id, line_id, stop_id, detected_at, applied_at, target_at, current_ratio,
         predicted_ratio, projected_ratio, confidence, headcount, capacity,
         vehicles_in_service, vehicle_id, alert_id, note)
  on conflict (id) do nothing
  returning id, applied_at
),
/* -- the numbered actions inside each decision ------------------------------- */
action_rows as (
  insert into ai_decision_actions (decision_id, seq, action_key, title, detail,
                                   relief_fraction, expected_relief_pct, evidence,
                                   target_label, applied, applied_at)
  select d.id, x.seq, x.action_key, x.title, x.detail, x.relief_fraction,
         x.expected_relief_pct, x.evidence::jsonb, x.target_label, true, d.applied_at
  from decision_rows d
  join lateral (
    values
      ('AID-0001', 1, 'deploy_vehicle', 'Deploy additional vehicle',
       'Release one standby unit onto Metro Line 2 for the evening peak — the same demand is spread across one more departure.',
       0.2000::numeric, 18.80::numeric,
       '[{"label":"Vehicles in service","value":"4"},{"label":"Headway","value":"5 min"},{"label":"Unit released","value":"M2-104"}]',
       'M2-104'),
      ('AID-0001', 2, 'redirect_passengers', 'Redirect passengers to BRT Corridor 1',
       'Steer boarding riders toward BRT Corridor 1 at Tidel Park, which runs 6-minute headways with spare capacity.',
       0.1200, 9.02,
       '[{"label":"Alt corridor","value":"BR1"},{"label":"Shared stop","value":"Tidel Park"},{"label":"Alt headway","value":"6 min"}]',
       'BR1 via Tidel Park'),
      ('AID-0001', 3, 'notify_passengers', 'Notify affected passengers',
       'Push the crowd advisory to riders boarding Metro Line 2 so some shift to the following departure.',
       0.0600, 3.97,
       '[{"label":"Riders reached","value":"21,450"},{"label":"Channel","value":"Rider app + station screens"}]',
       '21,450 riders'),
      ('AID-0002', 1, 'deploy_vehicle', 'Deploy additional vehicle',
       'Release one standby bus onto MTC 21G for the morning peak — the corridor runs three vehicles at a 10-minute headway.',
       0.2500, 22.75,
       '[{"label":"Vehicles in service","value":"3"},{"label":"Headway","value":"10 min"},{"label":"Unit released","value":"21G-104"}]',
       '21G-104'),
      ('AID-0002', 2, 'notify_passengers', 'Notify affected passengers',
       'Advisory to Tambaram boarders so flexible riders take the next departure.',
       0.0600, 4.09,
       '[{"label":"Riders reached","value":"11,820"},{"label":"Channel","value":"Rider app + station screens"}]',
       '11,820 riders')
  ) as x(decision_id, seq, action_key, title, detail, relief_fraction,
         expected_relief_pct, evidence, target_label) on x.decision_id = d.id
  on conflict (decision_id, seq) do nothing
  returning id
)
select
  (select count(*) from alert_rows)    as alerts_inserted,
  (select count(*) from decision_rows) as decisions_inserted,
  (select count(*) from action_rows)   as actions_inserted;
