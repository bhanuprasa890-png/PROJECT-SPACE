-- =============================================================================
-- TransitPulse AI · 0006 · Three-band crowd model + additive route score
-- =============================================================================
-- The commuter experience introduced one simple, explainable scoring rule:
--
--     route score = travel time + waiting time + crowd penalty
--
-- and three crowd bands everybody can remember:
--
--     below 60% occupancy   → Low
--     60% – 85%            → Moderate
--     above 85%            → High
--
-- Those bands are declared in `shared/crowd.ts` for the API and the UI. This
-- migration makes Postgres agree with them, and upgrades databases that were
-- created before the change (the earlier model had a fourth `critical` band
-- above 100% and a weighted, non-additive objective):
--
--   · `fn_crowd_level` now returns exactly low | moderate | high
--   · `fn_crowd_penalty_minutes` exposes the penalty curve in minute-equivalents
--   · `occupancy_predictions.crowd_level` constraint tightened to three values
--   · the canonical dataset is re-projected with the additive score
--
-- DEMO / SIMULATED DATA — no production content is touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Crowd band + penalty curve (same curves as shared/crowd.ts)
-- -----------------------------------------------------------------------------
create or replace function fn_crowd_level(p_ratio numeric)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_ratio, 0) > 0.85 then 'high'
    when p_ratio > 0.60 then 'moderate'
    else 'low'
  end;
$$;

comment on function fn_crowd_level(numeric) is
  'Occupancy ratio → commuter band: <60% low, 60-85% moderate, >85% high. Mirrors shared/crowd.ts.';

create or replace function fn_crowd_penalty_minutes(p_ratio numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_ratio, 0) <= 0 then 0
    when p_ratio <= 0.60 then round(p_ratio * 8, 3)
    when p_ratio <= 0.85 then round(4.8 + (p_ratio - 0.60) * 40, 3)
    else round(14.8 + power(p_ratio - 0.85, 1.35) * 120, 3)
  end;
$$;

comment on function fn_crowd_penalty_minutes(numeric) is
  'Crowd penalty in minute-equivalents: near-free below 60%, steady through 60-85%, steep past 85%. Mirrors shared/crowd.ts.';

-- -----------------------------------------------------------------------------
-- 2. Tighten the stored band constraint (databases migrated from the old model)
-- -----------------------------------------------------------------------------
-- Re-bucket first: rows written under the old four-band model (including
-- `critical`, which no longer exists) are converted before the constraint is
-- validated, so the migration is safe on a populated database.
update occupancy_predictions
   set crowd_level = fn_crowd_level(predicted_occupancy_percentage / 100.0)
 where crowd_level is distinct from fn_crowd_level(predicted_occupancy_percentage / 100.0);

alter table occupancy_predictions
  drop constraint if exists occupancy_predictions_crowd_level_check;

alter table occupancy_predictions
  add constraint occupancy_predictions_crowd_level_check
  check (crowd_level in ('low', 'moderate', 'high'));

-- -----------------------------------------------------------------------------
-- 3. Re-project the canonical dataset with the additive score
-- -----------------------------------------------------------------------------
select * from fn_refresh_demo_dataset();
