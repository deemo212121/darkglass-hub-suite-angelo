-- =====================================================================
-- 0288 — Manual "Issues" and "Lost" tally for the Part Daily Report's
-- Overview tab (src/components/ReportPartsDaily.tsx). These aren't
-- derivable from any existing table — they're a per-branch, per-day
-- count someone types in by hand (parts lost in the field, issues
-- encountered), separate from the employee-conduct Warnings/Mistakes
-- already tracked per staff member in employee_conduct_notes.
--
-- One row per (branch, day) — the Overview's date-range KPI tiles sum
-- across the rows in the selected range; the new "Issues & Lost by Day"
-- section at the bottom edits one row directly.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as ebay_branch_daily_notes (0281/0286).
-- Run once in the Supabase SQL Editor, after 0287.
-- =====================================================================

create table if not exists parts_daily_issues_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  branch      text not null,
  entry_date  date not null,
  issues      integer not null default 0 check (issues >= 0),
  lost        integer not null default 0 check (lost >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, branch, entry_date)
);
create index if not exists idx_parts_daily_issues_log_date on parts_daily_issues_log(company_id, entry_date);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function parts_daily_issues_log_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_parts_daily_issues_log_stamp on parts_daily_issues_log;
create trigger trg_parts_daily_issues_log_stamp before insert or update on parts_daily_issues_log
  for each row execute function parts_daily_issues_log_stamp();

-- ---------- RLS: company-scoped, same pattern as ebay_orders (0274) ----------
alter table parts_daily_issues_log enable row level security;
alter table parts_daily_issues_log force row level security;

drop policy if exists parts_daily_issues_log_select on parts_daily_issues_log;
create policy parts_daily_issues_log_select on parts_daily_issues_log
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_daily_issues_log_insert on parts_daily_issues_log;
create policy parts_daily_issues_log_insert on parts_daily_issues_log
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_daily_issues_log_update on parts_daily_issues_log;
create policy parts_daily_issues_log_update on parts_daily_issues_log
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists parts_daily_issues_log_delete on parts_daily_issues_log;
create policy parts_daily_issues_log_delete on parts_daily_issues_log
  for delete using (company_id = auth_company_id() or is_superadmin());
