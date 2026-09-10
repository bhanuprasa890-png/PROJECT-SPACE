-- =============================================================================
-- TransitPulse AI · 0000 · Supabase / Postgres compatibility shim
-- =============================================================================
-- The application runs against Supabase Postgres in production and against an
-- embedded Postgres (PGlite) in offline demo mode. Supabase ships an `auth`
-- schema with `auth.uid()`; the embedded engine does not, so we create an
-- equivalent stub **only when it is missing**. On a real Supabase project this
-- block is a no-op and the platform implementation is left untouched.
-- =============================================================================

do $$
begin
  -- Supabase ships these roles; the embedded engine does not, and RLS policies
  -- below grant to them by name, so they must exist either way.
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create schema if not exists auth;

    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    $fn$;

    execute $fn$
      create function auth.role() returns text
      language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.role'', true), '''')';
    $fn$;
  end if;
end
$$;
