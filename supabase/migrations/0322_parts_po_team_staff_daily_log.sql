-- =====================================================================
-- 0322 — Part Daily Report: per-PO-staffer daily tally
--
-- The Staff Changes Counter — PO Team roster (ReportPartsDaily.tsx) needs
-- Tickets Ordered / Parts Ordered / Pending Tickets broken out PER
-- PERSON, not just the company-wide total parts_po_team_daily_log (0321)
-- already tracks. There's no field anywhere that records who actually
-- placed an individual order (parts.created_by isn't populated), so these
-- are entered by hand per (staffer, day) — same manual-tally pattern as
-- parts_daily_issues_log, just keyed by profile_id instead of branch.
-- Internal Note here is per-person too, distinct from (and replacing the
-- removed) company-wide note on parts_po_team_daily_log.
--
-- Company-scoped via RLS, same pattern as parts_daily_issues_log (0288)/
-- parts_po_team_daily_log (0321).
-- Run once in the Supabase SQL Editor, after 0321.
-- =====================================================================

create table if not exists parts_po_team_staff_daily_log (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  entry_date      date not null,
  tickets_ordered integer not null default 0 check (tickets_ordered >= 0),
  parts_ordered   integer not null default 0 check (parts_ordered >= 0),
  pending_tickets integer not null default 0 check (pending_tickets >= 0),
  internal_note   text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, profile_id, entry_date)
);
create index if not exists idx_parts_po_team_staff_daily_log_date on parts_po_team_staff_daily_log(company_id, entry_date);
create index if not exists idx_parts_po_team_staff_daily_log_profile on parts_po_team_staff_daily_log(profile_id, entry_date);

create or replace function parts_po_team_staff_daily_log_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_parts_po_team_staff_daily_log_stamp on parts_po_team_staff_daily_log;
create trigger trg_parts_po_team_staff_daily_log_stamp before insert or update on parts_po_team_staff_daily_log
  for each row execute function parts_po_team_staff_daily_log_stamp();

alter table parts_po_team_staff_daily_log enable row level security;
alter table parts_po_team_staff_daily_log force row level security;

drop policy if exists parts_po_team_staff_daily_log_select on parts_po_team_staff_daily_log;
create policy parts_po_team_staff_daily_log_select on parts_po_team_staff_daily_log
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_po_team_staff_daily_log_insert on parts_po_team_staff_daily_log;
create policy parts_po_team_staff_daily_log_insert on parts_po_team_staff_daily_log
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_po_team_staff_daily_log_update on parts_po_team_staff_daily_log;
create policy parts_po_team_staff_daily_log_update on parts_po_team_staff_daily_log
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_po_team_staff_daily_log_delete on parts_po_team_staff_daily_log;
create policy parts_po_team_staff_daily_log_delete on parts_po_team_staff_daily_log
  for delete using (company_id = auth_company_id() or is_superadmin());
