-- =====================================================================
-- 0161 — Dashboard "Staff List" submodule.
--
-- Backs a new Dashboard tile (StaffListPage.tsx) built from the user's
-- "Staff List.xlsx" workbook: a per-branch technician roster (30 sheets
-- in the source file, 28 imported — see 0162's header comment for the 2
-- skipped), a branch-manager summary ("Current Staff" sheet), and a pay
-- rate table by tech tier ("Tier Level" sheet).
--
-- Same company-scoped RLS/trigger pattern as hr_leaders_roster (0153).
-- row_sort preserves each sheet's original row order.
--
-- Run once in the Supabase SQL Editor, after 0160. Real data import is a
-- separate step — see scripts/staff_list_seed.sql, run manually after this.
-- =====================================================================

-- ---------- staff_list_roster (the 28 per-branch sheets) ----------

create table if not exists staff_list_roster (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  branch          text not null,
  title           text,
  name            text not null,
  start_date      date,
  address         text,
  note            text,
  tier_level      text,
  personal_email  text,
  company_email   text,
  phone           text,
  work_phone      text,
  row_sort        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_staff_list_roster_company on staff_list_roster(company_id);
create index if not exists idx_staff_list_roster_branch on staff_list_roster(company_id, branch);

-- ---------- staff_list_current_staff (the "Current Staff" summary sheet) ----------

create table if not exists staff_list_current_staff (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  branch                 text not null,
  abbreviation           text,
  senior_branch_manager  text,
  branch_manager         text,
  technical_manager      text,
  part_manager           text,
  address                text,
  trash_company          text,
  phone                  text,
  row_sort               int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_staff_list_current_staff_company on staff_list_current_staff(company_id);

-- ---------- staff_list_tier_level (the "Tier Level" pay-rate table) ----------

create table if not exists staff_list_tier_level (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  tier                text not null,
  ticket_rate         numeric,
  mile_200            numeric,
  mile_300            numeric,
  mile_400            numeric,
  mileage_pay         numeric,
  branch_incentive    text,
  distance_home_comp  text,
  row_sort            int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_staff_list_tier_level_company on staff_list_tier_level(company_id);

-- ---------- Shared stamp/touch triggers + RLS (one pattern, 3 tables) ----------

create or replace function staff_list_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

create or replace function staff_list_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['staff_list_roster', 'staff_list_current_staff', 'staff_list_tier_level']
  loop
    execute format('drop trigger if exists trg_%1$s_stamp on %1$s', t);
    execute format('create trigger trg_%1$s_stamp before insert on %1$s for each row execute function staff_list_stamp()', t);

    execute format('drop trigger if exists trg_%1$s_touch on %1$s', t);
    execute format('create trigger trg_%1$s_touch before update on %1$s for each row execute function staff_list_touch()', t);

    execute format('alter table %1$s enable row level security', t);
    execute format('alter table %1$s force row level security', t);

    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select using (company_id = auth_company_id() or is_superadmin())', t);

    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (company_id = auth_company_id() or is_superadmin())', t);

    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('create policy %1$s_update on %1$s for update using (company_id = auth_company_id() or is_superadmin()) with check (company_id = auth_company_id() or is_superadmin())', t);

    execute format('drop policy if exists %1$s_delete on %1$s', t);
    execute format('create policy %1$s_delete on %1$s for delete using (company_id = auth_company_id() or is_superadmin())', t);
  end loop;
end $$;
