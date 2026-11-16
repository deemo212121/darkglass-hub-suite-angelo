-- =====================================================================
-- 0450 — Accounting → Daily Mileage.
--
-- The miles each technician drove, one row per technician per day, typed
-- (or pasted from Finance's workbook) by Accounting. The Mileage tab's
-- entries are built from ticket routes and run several times higher than
-- what is paid, so this is where the paid figure lives:
--   Technician · Day · Miles · Notes
-- The page totals each technician's miles, prices them at their Car IQ
-- rate for each day, and counts their >200 / >300 / >400 mile days.
--
-- Access:
--   add / edit / delete : Finance (Accounting), Admin, Super Admin
--   read                : the same
--
-- New table and functions only — nothing else is changed.
-- Safe to run again. Run once in the Supabase SQL Editor, after 0449.
-- =====================================================================

create or replace function tech_daily_mileage_can_access()
returns boolean language sql stable security definer set search_path = public as $$
  select is_finance() or is_admin() or is_company_superadmin() or is_superadmin();
$$;

create table if not exists tech_daily_mileage (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  work_date       date not null,
  miles           numeric(8,1) not null check (miles >= 0),
  notes           text not null default '',
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  unique (company_id, profile_id, work_date)
);

create index if not exists idx_tech_daily_mileage_company_date on tech_daily_mileage(company_id, work_date);

-- Company and who saved it come from the signed-in profile (not trusted from the page).
create or replace function tech_daily_mileage_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id());
begin
  if tg_op = 'INSERT' then
    new.company_id := auth_company_id();
    new.created_by_name := v_name;
    new.created_at := now();
  else
    new.company_id := old.company_id;
    new.profile_id := old.profile_id;
    new.work_date := old.work_date;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
  end if;
  new.updated_by_name := v_name;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tech_daily_mileage_stamp on tech_daily_mileage;
create trigger trg_tech_daily_mileage_stamp before insert or update on tech_daily_mileage
  for each row execute function tech_daily_mileage_stamp();

alter table tech_daily_mileage enable row level security;

drop policy if exists tech_daily_mileage_select on tech_daily_mileage;
create policy tech_daily_mileage_select on tech_daily_mileage
  for select using (company_id = auth_company_id() and tech_daily_mileage_can_access());

drop policy if exists tech_daily_mileage_insert on tech_daily_mileage;
create policy tech_daily_mileage_insert on tech_daily_mileage
  for insert with check (tech_daily_mileage_can_access());

drop policy if exists tech_daily_mileage_update on tech_daily_mileage;
create policy tech_daily_mileage_update on tech_daily_mileage
  for update using (company_id = auth_company_id() and tech_daily_mileage_can_access())
  with check (company_id = auth_company_id() and tech_daily_mileage_can_access());

drop policy if exists tech_daily_mileage_delete on tech_daily_mileage;
create policy tech_daily_mileage_delete on tech_daily_mileage
  for delete using (company_id = auth_company_id() and tech_daily_mileage_can_access());

notify pgrst, 'reload schema';
