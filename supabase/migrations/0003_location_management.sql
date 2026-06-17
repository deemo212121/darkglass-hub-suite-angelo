-- =====================================================================
-- AH Solutions — Location Management -> Supabase
--
-- Moves the three Location Management tabs off localStorage into Supabase:
--   1. location_mgmt_locations   (Locations tab)
--   2. location_mgmt_part_addresses (Part Addresses tab)
--   3. location_mgmt_coverage    (Covered Zip Codes tab)
--
-- Every row is company-scoped (company_id) and protected by RLS, matching the
-- rest of the platform. company_id is auto-stamped from the caller's session.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

-- ---------- 1. Locations ----------
create table if not exists location_mgmt_locations (
  id                    uuid primary key default uuid_generate_v4(),
  company_id            uuid not null references companies(id) on delete cascade,
  legacy_id             text,
  location              text not null,
  address1              text,
  address2              text,
  city                  text,
  state                 text,
  zip_code              text,
  office                text,
  coordinates           text,
  phone_no              text,
  email                 text,
  default_part_dist     text,
  rep_tech              text,
  office_location       text,
  check_processing      text default 'N',
  credit_card_processing text default 'N',
  permission            text default 'N',
  sms                   text default 'N',
  email_flag            text default 'N',
  auto_triage           text default 'N',
  encompass_pickup_wh   text default 'N',
  available_days        text[] default '{}',
  available_time_slot   text default 'ANY',
  covered_technicians   text[] default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_locmgmt_loc_company on location_mgmt_locations(company_id);

-- ---------- 2. Part Addresses ----------
create table if not exists location_mgmt_part_addresses (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies(id) on delete cascade,
  legacy_id   text,
  name        text,
  address1    text,
  address2    text,
  city        text,
  state       text,
  zip_code    text,
  location    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_locmgmt_part_company on location_mgmt_part_addresses(company_id);

-- ---------- 3. Coverage (covered zip codes) ----------
create table if not exists location_mgmt_coverage (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  legacy_id     text,
  location      text,
  zip_code      text not null,
  city          text,
  self_schedule text,
  days_later    text,
  tier_code     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_locmgmt_cov_company on location_mgmt_coverage(company_id);
create index if not exists idx_locmgmt_cov_zip on location_mgmt_coverage(company_id, zip_code);

-- ---------- Auto-stamp company_id from the caller's session ----------
-- Reuses set_company_id()/auth_company_id() defined in 0001. If a generic
-- stamp function isn't present, define a local one.
create or replace function locmgmt_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_locmgmt_loc_stamp on location_mgmt_locations;
create trigger trg_locmgmt_loc_stamp before insert on location_mgmt_locations
  for each row execute function locmgmt_stamp_company();

drop trigger if exists trg_locmgmt_part_stamp on location_mgmt_part_addresses;
create trigger trg_locmgmt_part_stamp before insert on location_mgmt_part_addresses
  for each row execute function locmgmt_stamp_company();

drop trigger if exists trg_locmgmt_cov_stamp on location_mgmt_coverage;
create trigger trg_locmgmt_cov_stamp before insert on location_mgmt_coverage
  for each row execute function locmgmt_stamp_company();

-- ---------- RLS: company-scoped, same pattern as the rest of the platform ----------
do $$
declare t text;
begin
  foreach t in array array[
    'location_mgmt_locations',
    'location_mgmt_part_addresses',
    'location_mgmt_coverage'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);

    execute format('drop policy if exists %1$s_select on %1$I;', t);
    execute format($f$
      create policy %1$s_select on %1$I
      for select using (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_insert on %1$I;', t);
    execute format($f$
      create policy %1$s_insert on %1$I
      for insert with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_update on %1$I;', t);
    execute format($f$
      create policy %1$s_update on %1$I
      for update using (company_id = auth_company_id() or is_superadmin())
                  with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_delete on %1$I;', t);
    execute format($f$
      create policy %1$s_delete on %1$I
      for delete using (company_id = auth_company_id() or is_superadmin());
    $f$, t);
  end loop;
end $$;
