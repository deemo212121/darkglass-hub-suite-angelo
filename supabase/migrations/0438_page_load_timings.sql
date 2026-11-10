-- =====================================================================
-- 0438 — Page Speed: how long each page takes to load, measured in the
-- browsers people actually use (AHS Server Status → Page Speed).
-- (0433 in Angelo's repo — renumbered here, past 0437_rls_check_user_once_per_query.)
--
-- One row per page opened:
--   shown_ms  — from the click (or the start of a full page load) until the
--               page's own content is on screen;
--   ready_ms  — until its data has finished loading (no requests to Supabase
--               or the app's server for a moment). Null when the person left
--               first (left_after_ms says when) or it never settled in a
--               minute (timed_out).
-- Plus the device (phone / tablet / computer, connection, memory, cores) and
-- the build (git_sha), so a deploy can be compared before and after.
--
-- Who can do what:
--   anyone signed in : adds rows for themselves (the server fills in who and
--                      which company — the browser can't claim to be someone
--                      else)
--   Admin and up     : read their company's rows (Admin, Super Admin, Super
--                      Super Admin — primary or extra role)
--   nobody           : edits or deletes; rows older than 30 days are cleared
--                      automatically now and then as new ones come in.
--
-- New table and functions only — nothing existing is changed.
-- Safe to rerun. Run once in the Supabase SQL Editor, after 0437.
-- =====================================================================

create table if not exists page_load_timings (
  id             bigint generated always as identity primary key,
  company_id     uuid not null references companies(id) on delete cascade,
  profile_id     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  path           text not null check (length(path) between 1 and 200),
  first_load     boolean not null default false,
  shown_ms       integer not null check (shown_ms between 0 and 600000),
  ready_ms       integer check (ready_ms between 0 and 600000),
  left_after_ms  integer check (left_after_ms between 0 and 600000),
  timed_out      boolean not null default false,
  requests       integer not null default 0 check (requests between 0 and 100000),
  device         text not null default 'computer' check (device in ('phone', 'tablet', 'computer')),
  connection     text check (length(connection) <= 20),
  memory_gb      real check (memory_gb between 0 and 1024),
  cores          smallint check (cores between 0 and 1024),
  screen_width   smallint check (screen_width between 0 and 20000),
  git_sha        text check (length(git_sha) <= 64)
);

create index if not exists idx_page_load_timings_company_created on page_load_timings(company_id, created_at desc);
create index if not exists idx_page_load_timings_company_path on page_load_timings(company_id, path, created_at desc);

-- ---------------------------------------------------------------------
-- Insert: the server says who and which company.
-- ---------------------------------------------------------------------
create or replace function page_load_timings_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.profile_id := auth_profile_id();
  new.company_id := auth_company_id();
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists trg_page_load_timings_before_insert on page_load_timings;
create trigger trg_page_load_timings_before_insert
  before insert on page_load_timings
  for each row execute function page_load_timings_before_insert();

-- Every so often (about 1 insert in 50), clear rows older than 30 days.
create or replace function page_load_timings_trim()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if random() < 0.02 then
    delete from page_load_timings where created_at < now() - interval '30 days';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_page_load_timings_trim on page_load_timings;
create trigger trg_page_load_timings_trim
  after insert on page_load_timings
  for each statement execute function page_load_timings_trim();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table page_load_timings enable row level security;

drop policy if exists page_load_timings_insert on page_load_timings;
create policy page_load_timings_insert on page_load_timings
  for insert with check (
    profile_id = (select auth_profile_id())
    and company_id = (select auth_company_id())
  );

drop policy if exists page_load_timings_select on page_load_timings;
create policy page_load_timings_select on page_load_timings
  for select using (
    company_id = (select auth_company_id())
    and ((select is_admin()) or (select is_company_superadmin()) or (select is_superadmin()))
  );

-- No update or delete policy: rows are never edited, only trimmed above.

-- ---------------------------------------------------------------------
-- Report: per page, and per day. They read through the rule above, so
-- only Admin and up get anything back.
-- ---------------------------------------------------------------------
create or replace function page_load_summary(p_since timestamptz, p_device text default null)
returns table (
  path text,
  opens bigint,
  shown_median integer,
  ready_median integer,
  ready_p90 integer,
  ready_max integer,
  left_early bigint,
  timed_out bigint,
  on_phone bigint,
  last_opened timestamptz
)
language sql stable security invoker set search_path = public as $$
  select
    t.path,
    count(*),
    (percentile_cont(0.5) within group (order by t.shown_ms))::integer,
    (percentile_cont(0.5) within group (order by t.ready_ms))::integer,
    (percentile_cont(0.9) within group (order by t.ready_ms))::integer,
    max(t.ready_ms),
    count(*) filter (where t.ready_ms is null and t.left_after_ms is not null),
    count(*) filter (where t.timed_out),
    count(*) filter (where t.device = 'phone'),
    max(t.created_at)
  from page_load_timings t
  where t.created_at >= p_since
    and (p_device is null or t.device = p_device)
  group by t.path
$$;

-- Days in US Central time, the same calendar the app's clock shows.
create or replace function page_load_daily(p_since timestamptz, p_device text default null)
returns table (day date, opens bigint, ready_median integer, ready_p90 integer)
language sql stable security invoker set search_path = public as $$
  select
    (t.created_at at time zone 'America/Chicago')::date,
    count(*),
    (percentile_cont(0.5) within group (order by t.ready_ms))::integer,
    (percentile_cont(0.9) within group (order by t.ready_ms))::integer
  from page_load_timings t
  where t.created_at >= p_since
    and (p_device is null or t.device = p_device)
  group by 1
  order by 1
$$;

notify pgrst, 'reload schema';
