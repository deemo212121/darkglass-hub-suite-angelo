-- =====================================================================
-- 0377 — AHS Server Status (SuperAdmin module).
--
-- The Worker's 5-minute cron checks every service the app depends on
-- (Supabase, Firebase, the Cloudflare hosting, the providers' own status
-- pages, and the outside APIs) and saves one row per service here, so the
-- Server Status page can show uptime % and a 30-day history.
--
-- server_cron_heartbeats: when each cron schedule last ran.
--
-- Only the server (service role) reads or writes these — RLS on, no
-- policies; the page goes through /api/server-status (SuperAdmin only).
-- Rows older than 30 days are pruned by the cron.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists server_status_checks (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  service text not null,
  status text not null check (status in ('up', 'slow', 'down')),
  response_ms integer,
  detail text
);
create index if not exists server_status_checks_service_time_idx on server_status_checks (service, checked_at desc);
create index if not exists server_status_checks_time_idx on server_status_checks (checked_at);
alter table server_status_checks enable row level security;

create table if not exists server_cron_heartbeats (
  job text primary key,
  last_run_at timestamptz not null default now(),
  ok boolean not null default true,
  detail text
);
alter table server_cron_heartbeats enable row level security;

-- Per service, per day (Central time): how many checks were up / slow / down.
create or replace function server_status_daily(p_days integer default 30)
returns table (service text, day date, total bigint, up bigint, slow bigint, down bigint)
language sql stable security definer set search_path = public as $$
  select service,
         (checked_at at time zone 'America/Chicago')::date as day,
         count(*) as total,
         count(*) filter (where status = 'up') as up,
         count(*) filter (where status = 'slow') as slow,
         count(*) filter (where status = 'down') as down
  from server_status_checks
  where checked_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1, 2
  order by 1, 2;
$$;

-- Per service: share of checks that were up or slow (i.e. reachable) in the last N hours.
create or replace function server_status_uptime(p_hours integer)
returns table (service text, total bigint, reachable bigint)
language sql stable security definer set search_path = public as $$
  select service, count(*) as total, count(*) filter (where status <> 'down') as reachable
  from server_status_checks
  where checked_at >= now() - make_interval(hours => greatest(p_hours, 1))
  group by 1;
$$;

revoke all on function server_status_daily(integer) from public, anon, authenticated;
revoke all on function server_status_uptime(integer) from public, anon, authenticated;
grant execute on function server_status_daily(integer) to service_role;
grant execute on function server_status_uptime(integer) to service_role;
