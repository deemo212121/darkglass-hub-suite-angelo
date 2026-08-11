-- =====================================================================
-- 0133 — Tech Payroll category count overrides
--
-- Every repair-type category (2 Man Job, Back Tub, Sealed System, ...) and
-- "Two Tech" are normally auto-counted from completed visits
-- (getTechCompletedRepairCounts / getTechSecondCounts). In practice a
-- technician's visits often don't have repair_type set correctly, so
-- Finance needs to be able to manually correct the count for a given
-- category/technician/period from the Tech Activity Report modal — this
-- table stores that correction. When a row exists here for a given
-- (profile, period, category) it takes precedence over the live count
-- everywhere that category's pay is computed (the Tech Activity Report AND
-- the main Tech Payroll table's Total Net), the same way Two Tech/MCA
-- already fold into Total Net.
--
-- category is free text matching REPAIR_TYPES/CROSS_REFERENCE_TYPES
-- (techPayroll.ts) — not a foreign key, same convention as
-- tech_repair_rates.repair_type.
--
-- Run once in the Supabase SQL Editor, after 0132.
-- =====================================================================

create table if not exists tech_category_overrides (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  category      text not null,
  count         numeric not null default 0,
  updated_at    timestamptz not null default now(),
  unique (profile_id, period_start, period_end, category)
);
create index if not exists idx_tech_category_overrides_period on tech_category_overrides(company_id, period_start, period_end);

create or replace function tech_category_overrides_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tech_category_overrides_stamp on tech_category_overrides;
create trigger trg_tech_category_overrides_stamp before insert or update on tech_category_overrides
  for each row execute function tech_category_overrides_stamp_and_touch();

alter table tech_category_overrides enable row level security;
alter table tech_category_overrides force row level security;

drop policy if exists tech_category_overrides_select on tech_category_overrides;
create policy tech_category_overrides_select on tech_category_overrides
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_category_overrides_insert on tech_category_overrides;
create policy tech_category_overrides_insert on tech_category_overrides
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_category_overrides_update on tech_category_overrides;
create policy tech_category_overrides_update on tech_category_overrides
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists tech_category_overrides_delete on tech_category_overrides;
create policy tech_category_overrides_delete on tech_category_overrides
  for delete using (company_id = auth_company_id() or is_superadmin());
