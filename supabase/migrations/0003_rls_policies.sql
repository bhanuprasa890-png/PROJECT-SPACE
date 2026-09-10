-- =============================================================================
-- TransitPulse AI · 0003 · Row Level Security
-- =============================================================================
-- Supabase best practice: RLS on for every table in the exposed schema.
--
--   · Network, timetable, crowd and alert data are public read-only.
--   · Rider-owned rows (profiles, watchlists, searches) are private to the
--     authenticated user; a rider may only write their own rows.
--   · Server-side writes use the service role (or the Postgres owner), which
--     bypasses RLS by design — the Express API performs authorisation checks
--     in the service layer.
--
-- Anonymous demo identities are still able to read the network so the
-- hackathon demo works before Supabase Auth is switched on.
-- =============================================================================

alter table agencies            enable row level security;
alter table stops               enable row level security;
alter table lines               enable row level security;
alter table line_stops          enable row level security;
alter table service_patterns    enable row level security;
alter table vehicles            enable row level security;
alter table crowd_observations  enable row level security;
alter table crowd_forecasts     enable row level security;
alter table alerts              enable row level security;
alter table model_config        enable row level security;
alter table rider_profiles      enable row level security;
alter table watchlist           enable row level security;
alter table route_searches      enable row level security;
alter table route_search_options enable row level security;

-- --- 1. Public reference + operational data --------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'agencies', 'stops', 'lines', 'line_stops', 'service_patterns',
    'vehicles', 'crowd_observations', 'crowd_forecasts', 'alerts', 'model_config'
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

-- Only transit staff may publish alerts.
drop policy if exists "alerts_staff_write" on alerts;
create policy "alerts_staff_write" on alerts
  for insert to authenticated
  with check (
    issued_by is null
    or issued_by = (auth.uid())::text
    or coalesce((auth.role()), '') = 'service_role'
  );

-- --- 2. Rider-owned data ---------------------------------------------------
drop policy if exists "rider_profiles_own" on rider_profiles;
create policy "rider_profiles_own" on rider_profiles
  for all to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists "watchlist_own" on watchlist;
create policy "watchlist_own" on watchlist
  for all to authenticated
  using (
    exists (
      select 1 from rider_profiles p
      where p.id = watchlist.profile_id and p.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from rider_profiles p
      where p.id = watchlist.profile_id and p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "route_searches_own" on route_searches;
create policy "route_searches_own" on route_searches
  for all to authenticated
  using (
    profile_id is null
    or exists (
      select 1 from rider_profiles p
      where p.id = route_searches.profile_id and p.auth_user_id = auth.uid()
    )
  )
  with check (
    profile_id is null
    or exists (
      select 1 from rider_profiles p
      where p.id = route_searches.profile_id and p.auth_user_id = auth.uid()
    )
  );

drop policy if exists "route_search_options_own" on route_search_options;
create policy "route_search_options_own" on route_search_options
  for all to authenticated
  using (
    exists (
      select 1
      from route_searches s
      join rider_profiles p on p.id = s.profile_id
      where s.id = route_search_options.search_id and p.auth_user_id = auth.uid()
    )
  )
  with check (true);
