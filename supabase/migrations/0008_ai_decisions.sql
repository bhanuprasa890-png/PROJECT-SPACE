-- =============================================================================
-- TransitPulse AI · 0008 · AI decision + intervention ledger
-- =============================================================================
-- The Operator Command Center does not only *advise* — an operator can act on a
-- recommendation. This migration adds the ledger for that loop:
--
--   ai_decisions         one row per AI congestion decision (proposed → applied)
--   ai_decision_actions  the numbered actions inside a decision, each with the
--                        relief it is expected to produce at the forecast peak
--   v_ai_interventions   read model behind the "recent interventions" strip
--
-- Applying a decision also moves a real `vehicles` row into service and writes a
-- row into `alerts`, so the operator console, the rider screens and the database
-- all agree on what happened — no value is invented in the UI.
--
-- DEMO / SIMULATED DATA: occupancy ratios, relief fractions and projected
-- occupancy come from the simulated prediction engine over the synthetic demo
-- dataset. They are not measurements of a real network and no production
-- accuracy is claimed.
-- =============================================================================

create table if not exists ai_decisions (
  id                    text primary key,
  agency_id             text not null references agencies (id) on delete cascade,
  line_id               text not null references lines (id) on delete cascade,
  stop_id               text references stops (id) on delete set null,
  status                text not null default 'proposed'
                        check (status in ('proposed', 'applied', 'reverted')),
  -- How the congestion instant was found: a live reading already above the
  -- threshold, the engine scan, or the route's recurring peak window.
  basis                 text not null default 'forecast'
                        check (basis in ('live', 'forecast', 'profile')),
  detected_at           timestamptz not null default now(),
  applied_at            timestamptz,
  -- The instant the decision is about (the forecast peak, not "now").
  target_at             timestamptz not null,
  horizon_minutes       integer not null check (horizon_minutes >= 0),
  minutes_to_congestion integer
                        check (minutes_to_congestion is null or minutes_to_congestion >= 0),
  current_ratio         numeric(5, 3) not null check (current_ratio >= 0),
  predicted_ratio       numeric(5, 3) not null check (predicted_ratio >= 0),
  projected_ratio       numeric(5, 3) not null check (projected_ratio >= 0),
  threshold_ratio       numeric(5, 3) not null check (threshold_ratio > 0),
  confidence            numeric(4, 3) not null check (confidence between 0 and 1),
  headcount             integer not null default 0 check (headcount >= 0),
  capacity              integer not null check (capacity > 0),
  vehicles_in_service   integer not null default 0 check (vehicles_in_service >= 0),
  -- Documented combination rule for the projected occupancy.
  method                text not null,
  model_version         text not null,
  vehicle_id            text references vehicles (id) on delete set null,
  alert_id              text references alerts (id) on delete set null,
  applied_by            text,
  note                  text,
  simulated             boolean not null default true,
  created_at            timestamptz not null default now(),
  -- An intervention can only ever improve on (or hold) the forecast.
  constraint ai_decisions_projection_not_worse
    check (projected_ratio <= predicted_ratio + 1e-6),
  constraint ai_decisions_applied_has_timestamp
    check (status <> 'applied' or applied_at is not null)
);

create index if not exists ai_decisions_line_idx on ai_decisions (line_id, detected_at desc);
create index if not exists ai_decisions_status_idx on ai_decisions (status, applied_at desc);
create index if not exists ai_decisions_applied_idx on ai_decisions (applied_at desc);

create table if not exists ai_decision_actions (
  id                 bigserial primary key,
  decision_id        text not null references ai_decisions (id) on delete cascade,
  seq                integer not null check (seq >= 1),
  action_key         text not null check (action_key in
                       ('deploy_vehicle', 'redirect_passengers', 'notify_passengers',
                        'tighten_headway')),
  title              text not null,
  detail             text not null,
  -- Share of the *remaining* peak load this action removes (0–1).
  relief_fraction    numeric(5, 4) not null check (relief_fraction between 0 and 1),
  -- Ratio points it removes at the forecast peak, so the impact table adds up.
  expected_relief_pct numeric(5, 2) not null check (expected_relief_pct >= 0),
  evidence           jsonb not null default '[]'::jsonb,
  target_label       text,
  applied            boolean not null default false,
  applied_at         timestamptz,
  unique (decision_id, seq),
  unique (decision_id, action_key)
);

create index if not exists ai_decision_actions_decision_idx
  on ai_decision_actions (decision_id, seq);

-- -----------------------------------------------------------------------------
-- Read model: the interventions an operator has actually applied
-- -----------------------------------------------------------------------------
create or replace view v_ai_interventions as
select
  d.id,
  d.line_id,
  l.code                                as route_number,
  l.name                                as route_name,
  l.color,
  l.mode,
  d.stop_id,
  s.name                                as stop_name,
  d.status,
  d.basis,
  d.detected_at,
  d.applied_at,
  d.target_at,
  d.minutes_to_congestion,
  round(d.current_ratio * 100, 1)       as current_pct,
  round(d.predicted_ratio * 100, 1)     as predicted_pct,
  round(d.projected_ratio * 100, 1)     as projected_pct,
  round((d.predicted_ratio - d.projected_ratio) * 100, 1) as relief_pct,
  round(d.confidence * 100, 1)          as confidence_pct,
  d.headcount,
  d.capacity,
  d.vehicles_in_service,
  d.vehicle_id,
  v.code                                as vehicle_code,
  d.alert_id,
  a.title                               as alert_title,
  d.applied_by,
  d.note,
  d.method,
  d.model_version,
  d.simulated,
  (select count(*)::int from ai_decision_actions x where x.decision_id = d.id) as action_count,
  (select coalesce(json_agg(x.action_key order by x.seq), '[]'::json) from ai_decision_actions x
    where x.decision_id = d.id)         as action_keys
from ai_decisions d
join lines l  on l.id = d.line_id
left join stops s on s.id = d.stop_id
left join vehicles v on v.id = d.vehicle_id
left join alerts a on a.id = d.alert_id;

comment on view v_ai_interventions is
  'DEMO DATA · AI congestion decisions with the intervention outcome, for the operator console.';
comment on table ai_decisions is
  'DEMO DATA · SIMULATED · AI congestion decisions and the interventions applied from the operator console.';
comment on table ai_decision_actions is
  'DEMO DATA · SIMULATED · Numbered actions inside an AI decision with their modelled relief.';

-- -----------------------------------------------------------------------------
-- Row Level Security — public read, staff-managed (mirrors migration 0003)
-- -----------------------------------------------------------------------------
alter table ai_decisions        enable row level security;
alter table ai_decision_actions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['ai_decisions', 'ai_decision_actions']
  loop
    execute format('drop policy if exists "%s_public_read" on %I', t, t);
    execute format(
      'create policy "%s_public_read" on %I for select to anon, authenticated using (true)',
      t, t
    );
  end loop;
end
$$;
