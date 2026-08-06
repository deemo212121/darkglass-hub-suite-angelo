-- =====================================================================
-- 0125 — Technician mileage log
--
-- Replaces the external Google Sheet ("Total Mileage" per branch, one
-- sheet-tab per branch, columns per technician: Total Mileage + Google
-- map link, rows by date) with an in-app log on Accounting Dashboard's
-- new Mileage tab. Fully manual entry (mileage figure and map link are
-- both typed in, not calculated) — not linked to tickets/visits.
--
-- branch is a plain client-supplied snapshot of the picked technician's
-- assigned_branch at entry time (same convention as
-- getTechCompletedRepairCounts snapshotting a ticket's location) so a
-- historical entry keeps showing under the branch it was logged for even
-- if that technician is later reassigned to a different branch.
--
-- Same company-scoped RLS pattern as tech_repair_rates (0120).
-- Run once in the Supabase SQL Editor, after 0124.
-- =====================================================================

create table if not exists mileage_entries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  branch          text not null,
  work_date       date not null,
  address         text not null,
  contact_number  text,
  email           text,
  total_mileage   numeric not null,
  google_map_link text,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_mileage_entries_company on mileage_entries(company_id);
create index if not exists idx_mileage_entries_branch on mileage_entries(branch);

create or replace function mileage_entries_stamp_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mileage_entries_stamp on mileage_entries;
create trigger trg_mileage_entries_stamp before insert on mileage_entries
  for each row execute function mileage_entries_stamp_company();

alter table mileage_entries enable row level security;
alter table mileage_entries force row level security;

drop policy if exists mileage_entries_select on mileage_entries;
create policy mileage_entries_select on mileage_entries
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists mileage_entries_insert on mileage_entries;
create policy mileage_entries_insert on mileage_entries
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists mileage_entries_update on mileage_entries;
create policy mileage_entries_update on mileage_entries
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists mileage_entries_delete on mileage_entries;
create policy mileage_entries_delete on mileage_entries
  for delete using (company_id = auth_company_id() or is_superadmin());
