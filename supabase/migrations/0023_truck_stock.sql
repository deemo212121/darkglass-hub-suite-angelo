-- =====================================================================
-- 0023 — Truck Stock (per-branch / per-truck in-house inventory)
--
-- Tracks which parts each branch (or technician's truck) is currently
-- holding so:
--   • the Parts module → Truck Stock page can list everything in-house
--     per branch (with cross-branch availability),
--   • the Marcone Lookup button on Part Transaction can also surface
--     "you already have N of these in-house" alongside Marcone's online
--     warehouse counts (saves an unnecessary PO).
--
-- Auth model matches the rest of the platform: Firebase Auth issues the
-- JWT, profiles.firebase_uid maps the JWT `sub` to a profile row, and
-- auth_company_id() / is_superadmin() are the platform helpers used for
-- RLS. company_id is auto-stamped on insert.
--
-- Unique constraint on (company_id, branch, part_no) keeps quantities
-- additive — re-importing the inventory spreadsheet bumps existing rows
-- instead of duplicating them.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists truck_stock (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  branch            text not null,
  part_no           text not null,
  description       text,
  manufacturer      text,
  quantity          integer not null default 0,
  storage_location  text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint truck_stock_unique unique (company_id, branch, part_no)
);

-- For tables created before storage_location existed.
alter table truck_stock add column if not exists storage_location text;

create index if not exists truck_stock_part_no_idx on truck_stock (company_id, part_no);
create index if not exists truck_stock_branch_idx  on truck_stock (company_id, branch);

-- ---------- Cleanup old (broken) trigger from initial 0023 release ----------
-- The first cut of this migration used `auth.uid()` directly which returns
-- a Firebase UID string and can't cast to a Postgres UUID. Drop the old
-- trigger + function so the new ones below take over cleanly.
drop trigger if exists truck_stock_company_trigger on truck_stock;
drop function if exists truck_stock_set_company();

-- ---------- Auto-stamp company_id from the caller's session ----------
-- Reuses auth_company_id() from 0001_init.sql (looks up the caller's
-- profile by firebase_uid → company_id). Also bumps updated_at on
-- every update.
create or replace function truck_stock_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT') and new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_truck_stock_stamp on truck_stock;
create trigger trg_truck_stock_stamp
  before insert or update on truck_stock
  for each row execute function truck_stock_stamp_company();

-- ---------- RLS: company-scoped, matches location_mgmt_* pattern ----------
alter table truck_stock enable row level security;
alter table truck_stock force row level security;

drop policy if exists truck_stock_select on truck_stock;
create policy truck_stock_select on truck_stock
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists truck_stock_insert on truck_stock;
create policy truck_stock_insert on truck_stock
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists truck_stock_update on truck_stock;
create policy truck_stock_update on truck_stock
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists truck_stock_delete on truck_stock;
create policy truck_stock_delete on truck_stock
  for delete using (company_id = auth_company_id() or is_superadmin());
