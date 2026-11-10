-- =====================================================================
-- 0437 — Faster reads on every page: security rules check "who is this
-- user" once per query instead of once per row.
-- (0432 in Angelo's repo — renumbered here, past 0436_email_vault.)
--
-- Almost every table's security rule calls helpers like auth_company_id()
-- or is_superadmin() (about 900 calls across the rules). Written plainly,
-- Postgres runs the helper again for every row it looks at, so reading the
-- company's 20,000+ tickets ran each helper 20,000+ times — each one its own
-- lookup in profiles. Wrapped as (select auth_company_id()), Postgres runs it
-- once per query and reuses the answer. This is Supabase's own recommended
-- fix for slow security rules.
--
-- Nothing about who can see or change what is different: each helper takes
-- no arguments and is marked STABLE, which means it gives the same answer for
-- the whole query anyway. Only helpers that return a single value are
-- wrapped — a helper that returns a list (my_csr_team_member_ids()), or one
-- that takes a row's value (can_access_private_channel(channel_id)), is left
-- exactly as it is.
--
-- It rewrites the rules as they are live in the database (pg_policies), not
-- as the migration files describe them, so any change made directly in
-- Supabase is kept. A rule that can't be rewritten is left as it was and
-- listed at the end; the others still go through.
--
-- Safe to rerun: a rule that's already been rewritten isn't wrapped twice.
-- Run once in the Supabase SQL Editor, after 0436. The result shows how many
-- rules now check once per query, and lists any still checking per row.
-- =====================================================================

do $$
declare
  v_names text;
  v_re text;
  pol record;
  v_qual text;
  v_check text;
  v_sql text;
begin
  -- Every no-argument, single-value, STABLE/IMMUTABLE function in public.
  select string_agg(proname, '|' order by length(proname) desc)
    into v_names
  from (
    select distinct p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.pronargs = 0
      and p.prokind = 'f'
      and not p.proretset
      and p.provolatile in ('s', 'i')
      and p.prorettype <> 'trigger'::regtype
  ) f;

  if v_names is null then
    return;
  end if;

  -- A bare call: not part of a longer name, not schema-qualified by anything
  -- other than public, and not already inside "( SELECT name() ...".
  v_re := '(?<![A-Za-z0-9_.])(?<!SELECT )((?:public\.)?(?:' || v_names || '))\(\)';

  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ v_re or coalesce(with_check, '') ~ v_re)
    order by tablename, policyname
  loop
    v_qual := case when pol.qual is null then null else regexp_replace(pol.qual, v_re, '(select \1())', 'g') end;
    v_check := case when pol.with_check is null then null else regexp_replace(pol.with_check, v_re, '(select \1())', 'g') end;
    v_sql := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    begin
      execute v_sql;
    exception when others then
      raise notice '%.% left as it was: %', pol.tablename, pol.policyname, sqlerrm;
    end;
  end loop;
end;
$$;

-- What the rules look like now.
with helpers as (
  select string_agg(proname, '|' order by length(proname) desc) as names
  from (
    select distinct p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.pronargs = 0 and p.prokind = 'f' and not p.proretset
      and p.provolatile in ('s', 'i') and p.prorettype <> 'trigger'::regtype
  ) f
), re as (
  select '(?<![A-Za-z0-9_.])(?<!SELECT )((?:public\.)?(?:' || names || '))\(\)' as bare from helpers
), rules as (
  select tablename || '.' || policyname as rule, coalesce(qual, '') || ' ' || coalesce(with_check, '') as body
  from pg_policies
  where schemaname = 'public'
)
select
  count(*) filter (where body ~ 'SELECT [a-z_]+\(\) AS ') as rules_checking_once,
  count(*) filter (where body ~ re.bare) as rules_still_per_row,
  coalesce(string_agg(rule, ', ' order by rule) filter (where body ~ re.bare), 'none') as still_per_row
from rules, re;
