-- =====================================================================
-- 0309 — Part Daily Report: Daily Branch Activity manual columns +
-- PO Team's Daily Report
--
-- 1. Extends parts_daily_issues_log (0288) with three more manual,
--    per-branch-per-day columns for the Daily Branch Activity table:
--    Not Recovered, Total Warnings, Remarks — same "nobody derives this
--    from existing data" reasoning as issues/lost.
--
-- 2. New parts_po_team_daily_log — the Overview tab's chart section is
--    being replaced with "PO Team's Daily Report": No. of Tickets
--    Ordered / No. of Parts Ordered are computed live from parts.po_date
--    (see ReportPartsDaily.tsx), so nothing to store for those. No. of
--    Pending Tickets and Internal Note have no live data source (Pending
--    Tickets would need a same-day 2PM CST snapshot this app doesn't
--    take), so the PO Team enters both by hand — one row per (company,
--    day), unlike the per-branch log above.
--
-- Company-scoped via RLS, same pattern as parts_daily_issues_log.
-- Run once in the Supabase SQL Editor, after 0308.
-- =====================================================================

alter table parts_daily_issues_log add column if not exists not_recovered integer not null default 0 check (not_recovered >= 0);
alter table parts_daily_issues_log add column if not exists total_warnings integer not null default 0 check (total_warnings >= 0);
alter table parts_daily_issues_log add column if not exists remarks text not null default '';

create table if not exists parts_po_team_daily_log (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  entry_date      date not null,
  pending_tickets integer not null default 0 check (pending_tickets >= 0),
  internal_note   text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, entry_date)
);
create index if not exists idx_parts_po_team_daily_log_date on parts_po_team_daily_log(company_id, entry_date);

create or replace function parts_po_team_daily_log_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_parts_po_team_daily_log_stamp on parts_po_team_daily_log;
create trigger trg_parts_po_team_daily_log_stamp before insert or update on parts_po_team_daily_log
  for each row execute function parts_po_team_daily_log_stamp();

alter table parts_po_team_daily_log enable row level security;
alter table parts_po_team_daily_log force row level security;

drop policy if exists parts_po_team_daily_log_select on parts_po_team_daily_log;
create policy parts_po_team_daily_log_select on parts_po_team_daily_log
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_po_team_daily_log_insert on parts_po_team_daily_log;
create policy parts_po_team_daily_log_insert on parts_po_team_daily_log
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_po_team_daily_log_update on parts_po_team_daily_log;
create policy parts_po_team_daily_log_update on parts_po_team_daily_log
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_po_team_daily_log_delete on parts_po_team_daily_log;
create policy parts_po_team_daily_log_delete on parts_po_team_daily_log
  for delete using (company_id = auth_company_id() or is_superadmin());
