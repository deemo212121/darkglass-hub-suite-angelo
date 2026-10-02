-- =====================================================================
-- 0341 — Daily clock-in codes.
--
-- Every active technician gets one 4-digit code per day, made
-- automatically the first time HR opens HR → Clock-In Codes that day. The
-- code works once, any time that day: the Parts Manager picks the
-- technician on Part Daily Pickup, types the code, and the technician's
-- time in is stamped.
--
--   - "Today" is the Central-time date (America/Chicago).
--   - Codes are only readable by HR / Admin / SuperAdmin (RLS). Parts never
--     see them; they can only redeem through redeem_clock_in_code().
--   - Writes go only through the functions below (no insert/update policies).
--   - HR can regenerate one technician's code; the old one stops working.
--   - 5 wrong tries lock that day's code; HR regenerates it.
--   - Redeeming follows the Approval Chain clock-in rule (chain_can_clock_in):
--     Parts can only clock in their own branch.
--
-- Safe to run more than once. Run in the Supabase SQL Editor, after 0340.
-- =====================================================================

create table if not exists clock_in_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  code text not null,
  valid_date date not null default (now() at time zone 'America/Chicago')::date,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references profiles(id) on delete set null,
  failed_attempts int not null default 0,
  -- 'replaced' (HR regenerated it) or 'too_many_attempts'
  revoked_reason text
);
-- (An earlier draft of this migration had a 2-minute expires_at instead of valid_date.)
alter table clock_in_codes add column if not exists valid_date date not null default (now() at time zone 'America/Chicago')::date;
alter table clock_in_codes drop column if exists expires_at;
drop function if exists generate_clock_in_code(uuid);

-- One live code per technician per day.
create unique index if not exists clock_in_codes_live_uidx on clock_in_codes (profile_id, valid_date) where revoked_reason is null;
create index if not exists clock_in_codes_company_day_idx on clock_in_codes (company_id, valid_date);

alter table clock_in_codes enable row level security;
alter table clock_in_codes force row level security;

create or replace function clock_code_today()
returns date language sql stable as $$
  select (now() at time zone 'America/Chicago')::date;
$$;

/** Can the signed-in user see / manage clock-in codes? HR, Admin, SuperAdmin. */
create or replace function clock_code_issuer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth_profile_id()
      and array(select upper(x) from unnest(array_append(coalesce(p.extra_roles, '{}'), p.role)) x where x is not null)
          && array['HR', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN']
  );
$$;

drop policy if exists clock_in_codes_select on clock_in_codes;
create policy clock_in_codes_select on clock_in_codes
  for select using (company_id = auth_company_id() and clock_code_issuer());

/** Make today's code for every active technician who doesn't have one yet. Returns today's date. */
create or replace function ensure_daily_clock_in_codes()
returns date language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  co uuid := auth_company_id();
  d date := clock_code_today();
begin
  if me is null or not clock_code_issuer() then
    raise exception 'Only HR can see clock-in codes.';
  end if;
  insert into clock_in_codes (company_id, profile_id, code, valid_date, created_by)
  select co, p.id, lpad(floor(random() * 10000)::int::text, 4, '0'), d, null
  from profiles p
  where p.company_id = co
    and p.is_active
    and chain_level_held(p.role, p.extra_roles) = 'tech'
    and chain_norm_branch(p.assigned_branch) <> 'philippines'
    and not exists (
      select 1 from clock_in_codes c where c.profile_id = p.id and c.valid_date = d and c.revoked_reason is null
    );
  return d;
end;
$$;

/** New code for one technician today (the old one stops working). Returns the new code. */
create or replace function regenerate_clock_in_code(p_target uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  co uuid := auth_company_id();
  d date := clock_code_today();
  c text := lpad(floor(random() * 10000)::int::text, 4, '0');
begin
  if me is null or not clock_code_issuer() then
    raise exception 'Only HR can regenerate clock-in codes.';
  end if;
  if not exists (select 1 from profiles where id = p_target and company_id = co) then
    raise exception 'That employee is not in your company.';
  end if;
  update clock_in_codes set revoked_reason = 'replaced'
    where profile_id = p_target and valid_date = d and revoked_reason is null;
  insert into clock_in_codes (company_id, profile_id, code, valid_date, created_by)
    values (co, p_target, c, d, me);
  return c;
end;
$$;

-- Returns: ok | wrong | locked | used | no_code | not_allowed | not_signed_in
create or replace function redeem_clock_in_code(p_target uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  r clock_in_codes%rowtype;
begin
  if me is null then return 'not_signed_in'; end if;
  if chain_can_clock_in(me, p_target) is false then return 'not_allowed'; end if;
  select * into r from clock_in_codes
    where profile_id = p_target and company_id = auth_company_id()
      and valid_date = clock_code_today() and revoked_reason is null
    limit 1
    for update;
  if not found then return 'no_code'; end if;
  if r.used_at is not null then return 'used'; end if;
  if r.code <> trim(coalesce(p_code, '')) then
    update clock_in_codes
      set failed_attempts = failed_attempts + 1,
          revoked_reason = case when failed_attempts + 1 >= 5 then 'too_many_attempts' else null end
      where id = r.id;
    return case when r.failed_attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  update clock_in_codes set used_at = now(), used_by = me where id = r.id;
  return 'ok';
end;
$$;

grant execute on function ensure_daily_clock_in_codes() to authenticated;
grant execute on function regenerate_clock_in_code(uuid) to authenticated;
grant execute on function redeem_clock_in_code(uuid, text) to authenticated;
grant execute on function clock_code_issuer() to authenticated;
grant execute on function clock_code_today() to authenticated;
