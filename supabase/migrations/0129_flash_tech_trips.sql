-- =====================================================================
-- 0129 — Flash Tech Calendar: technician travel schedules
--
-- Backs the "Flash Tech Calendar" Dashboard tile: plots a technician's
-- (or any staff member's — e.g. a Branch Manager covering another branch)
-- temporary relocation as a date range (origin -> destination), so
-- Hotel/Transportation costs for the trip can be scheduled ahead of time
-- and tracked through the existing Expense Tracking pipeline (see
-- 0130_expenses_flash_tech_trip.sql for the link).
--
-- Only SuperAdmin/Admin/Finance may create, edit, or delete trips — every
-- signed-in company member can view the calendar. Mirrors the is_admin()
-- pattern from 0089_login_events.sql, adding an equivalent is_finance().
--
-- Run once in the Supabase SQL Editor, after 0128.
-- =====================================================================

create table if not exists flash_tech_trips (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id) on delete cascade,
  -- Nullable: the traveling person may not always resolve to a real
  -- profile (e.g. a contractor), so technician_name (free text, shown on
  -- the calendar) is the source of truth for display; the FK is best-effort
  -- linkage back to a real profile when one was picked from the roster.
  technician_profile_id  uuid references profiles(id) on delete set null,
  technician_name         text not null,
  origin_location         text not null,
  destination_location    text not null,
  start_date               date not null,
  end_date                 date not null,
  notes                    text,
  created_by              uuid references profiles(id) on delete set null,
  created_by_name         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_flash_tech_trips_company on flash_tech_trips(company_id);
create index if not exists idx_flash_tech_trips_dates on flash_tech_trips(start_date, end_date);

create or replace function flash_tech_trips_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_flash_tech_trips_stamp on flash_tech_trips;
create trigger trg_flash_tech_trips_stamp before insert or update on flash_tech_trips
  for each row execute function flash_tech_trips_stamp();

alter table flash_tech_trips enable row level security;
alter table flash_tech_trips force row level security;

-- Parallels is_admin() (0089_login_events.sql) — same SECURITY DEFINER
-- pattern, checking the FINANCE role (primary or extra_roles).
create or replace function is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role = 'FINANCE' or 'FINANCE' = any(extra_roles))
  );
$$;

-- Any company member can view the calendar.
drop policy if exists flash_tech_trips_select on flash_tech_trips;
create policy flash_tech_trips_select on flash_tech_trips
  for select using (company_id = auth_company_id() or is_superadmin());

-- Only SuperAdmin/Admin/Finance may schedule, edit, or remove a trip.
drop policy if exists flash_tech_trips_insert on flash_tech_trips;
create policy flash_tech_trips_insert on flash_tech_trips
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_superadmin())
  );

drop policy if exists flash_tech_trips_update on flash_tech_trips;
create policy flash_tech_trips_update on flash_tech_trips
  for update using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_superadmin())
  )
  with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_superadmin())
  );

drop policy if exists flash_tech_trips_delete on flash_tech_trips;
create policy flash_tech_trips_delete on flash_tech_trips
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_finance() or is_superadmin())
  );
