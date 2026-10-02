-- =====================================================================
-- 0344 — One clock-in code per day for the whole company.
--
-- Replaces the per-technician codes from 0341/0342 (and 0343's rules).
--
--   - Each day (Central-time date) the company has ONE 4-digit code, made
--     automatically the first time HR opens HR → Clock-In Codes (or the
--     first time someone tries to Time In). Everyone uses the same code all
--     day; HR can make a new one (the old one stops working).
--   - Who needs it to Time In: anyone holding (as primary OR extra role)
--     Technician, Technician Manager, Branch Manager, Senior Branch Manager,
--     Technical Director or Technical Assistant Director — not Philippines. Everyone else
--     clocks in as before. Anyone already clocked in keeps their punch.
--   - A Parts Manager can also type the code on Part Daily Pickup to clock
--     in a technician at their branch (Approval Chain clock-in rule).
--   - 5 wrong tries lock that one person for the rest of the code's life;
--     HR's "New code" resets it.
--   - The code and the who-used-it log are only readable by HR / Admin /
--     SuperAdmin; writes only go through the functions below.
--
-- Run in the Supabase SQL Editor, after 0342. Safe to run again. (0343 is not needed —
-- this file replaces it; running it anyway is harmless.)
-- =====================================================================

-- The per-technician version had no real use yet.
drop function if exists ensure_daily_clock_in_codes();
drop function if exists regenerate_clock_in_code(uuid);
drop function if exists generate_clock_in_code(uuid);
drop table if exists clock_in_codes cascade;

create or replace function clock_code_today()
returns date language sql stable as $$
  select (now() at time zone 'America/Chicago')::date;
$$;

create or replace function clock_code_issuer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(select upper(x) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x where x is not null)
          && array['HR', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN']
  );
$$;

create table if not exists clock_in_daily_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  valid_date date not null,
  code text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);
create unique index if not exists clock_in_daily_codes_live_uidx on clock_in_daily_codes (company_id, valid_date) where not revoked;

-- Every code entry: who it was for, who typed it, and whether it was right.
create table if not exists clock_in_code_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  valid_date date not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  entered_by uuid references profiles(id) on delete set null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists clock_in_code_events_day_idx on clock_in_code_events (company_id, valid_date, created_at desc);

alter table clock_in_daily_codes enable row level security;
alter table clock_in_daily_codes force row level security;
alter table clock_in_code_events enable row level security;
alter table clock_in_code_events force row level security;

drop policy if exists clock_in_daily_codes_select on clock_in_daily_codes;
create policy clock_in_daily_codes_select on clock_in_daily_codes
  for select using (company_id = auth_company_id() and clock_code_issuer());
drop policy if exists clock_in_code_events_select on clock_in_code_events;
create policy clock_in_code_events_select on clock_in_code_events
  for select using (company_id = auth_company_id() and clock_code_issuer());

/** Today's company code — made if there isn't one yet. HR / Admin / SuperAdmin only. */
create or replace function ensure_company_clock_in_code()
returns table (out_code text, out_date date, out_created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  co uuid := auth_company_id();
  d date := clock_code_today();
begin
  if auth_profile_id() is null or not clock_code_issuer() then
    raise exception 'Only HR can see the clock-in code.';
  end if;
  insert into clock_in_daily_codes (company_id, valid_date, code)
    values (co, d, lpad(floor(random() * 10000)::int::text, 4, '0'))
    on conflict (company_id, valid_date) where not revoked do nothing;
  return query
    select c.code, c.valid_date, c.created_at from clock_in_daily_codes c
    where c.company_id = co and c.valid_date = d and not c.revoked;
end;
$$;

/** New company code for today; the old one stops working and everyone's wrong-try count resets. */
create or replace function regenerate_company_clock_in_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  co uuid := auth_company_id();
  d date := clock_code_today();
  c text := lpad(floor(random() * 10000)::int::text, 4, '0');
begin
  if auth_profile_id() is null or not clock_code_issuer() then
    raise exception 'Only HR can make a new clock-in code.';
  end if;
  perform pg_advisory_xact_lock(hashtext('clock_in_code:' || co::text));
  update clock_in_daily_codes set revoked = true where company_id = co and valid_date = d and not revoked;
  insert into clock_in_daily_codes (company_id, valid_date, code, created_by) values (co, d, c, auth_profile_id());
  return c;
end;
$$;

/**
 * Does the signed-in user need the code to Time In? Yes if ANY role they hold
 * (primary or extra — e.g. a SuperAdmin with Technician as a second role) is
 * one of these, unless they're Philippines staff.
 */
create or replace function clock_in_code_required()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select chain_norm_branch(p.assigned_branch) <> 'philippines'
       and array(select upper(x) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x where x is not null)
           && array['TECHNICIAN', 'TECHNICIAN_MANAGER', 'BRANCH_MANAGER', 'SENIOR_BRANCH_MANAGER', 'TECHNICAL_DIRECTOR', 'TECHNICAL_ASSISTANT_DIRECTOR']
    from profiles p where p.id = auth_profile_id()
  ), false);
$$;

-- Check the company code for p_target's Time In (your own, or someone you
-- may clock in). Returns: ok | wrong | locked | no_code | not_allowed | not_signed_in
create or replace function redeem_clock_in_code(p_target uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  co uuid := auth_company_id();
  d date := clock_code_today();
  cur clock_in_daily_codes%rowtype;
  fails int;
begin
  if me is null then return 'not_signed_in'; end if;
  if me <> p_target and chain_can_clock_in(me, p_target) is false then return 'not_allowed'; end if;
  if not exists (select 1 from profiles where id = p_target and company_id = co) then return 'not_allowed'; end if;

  select * into cur from clock_in_daily_codes where company_id = co and valid_date = d and not revoked;
  if not found then
    insert into clock_in_daily_codes (company_id, valid_date, code)
      values (co, d, lpad(floor(random() * 10000)::int::text, 4, '0'))
      on conflict (company_id, valid_date) where not revoked do nothing;
    return 'no_code';
  end if;

  select count(*) into fails from clock_in_code_events
    where profile_id = p_target and valid_date = d and not success and created_at >= cur.created_at;
  if fails >= 5 then return 'locked'; end if;

  if cur.code <> trim(coalesce(p_code, '')) then
    insert into clock_in_code_events (company_id, valid_date, profile_id, entered_by, success) values (co, d, p_target, me, false);
    return case when fails + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  insert into clock_in_code_events (company_id, valid_date, profile_id, entered_by, success) values (co, d, p_target, me, true);
  return 'ok';
end;
$$;

grant execute on function ensure_company_clock_in_code() to authenticated;
grant execute on function regenerate_company_clock_in_code() to authenticated;
grant execute on function clock_in_code_required() to authenticated;
grant execute on function redeem_clock_in_code(uuid, text) to authenticated;
grant execute on function clock_code_issuer() to authenticated;
grant execute on function clock_code_today() to authenticated;
