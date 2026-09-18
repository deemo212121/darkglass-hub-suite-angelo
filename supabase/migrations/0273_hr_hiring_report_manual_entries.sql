-- =====================================================================
-- 0273 — Manual entries (Budget, Sponsored, Others) for the rebuilt
-- EOD/EOM Hiring Report (ReportHRDaily.tsx's "Generate Report" tab) — the
-- report is now 3 sections (Technician / Parts Manager / Philippine
-- Staff), each row a branch (Technician/Parts Manager) or department
-- (Philippine Staff). Everything else on the report is computed live
-- (Interview/Staff Need/Hired/CVs Sent to BM/Terminated-Resigned/Warning);
-- these three columns have no other source, so they're typed in by hand
-- and saved per (period, section, row).
--
-- period_type/period_key together identify which report + which date this
-- is for: ('eod', 'YYYY-MM-DD') for one day, ('eom', 'YYYY-MM') for one
-- month.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as csr_daily_report_entries (0270).
-- Run once in the Supabase SQL Editor, after 0272.
-- =====================================================================

create table if not exists hr_hiring_report_manual_entries (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  period_type  text not null check (period_type in ('eod', 'eom')),
  period_key   text not null,
  section      text not null check (section in ('technician', 'parts_manager', 'philippine_staff')),
  group_key    text not null,
  budget       numeric,
  sponsored    numeric,
  others       numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, period_type, period_key, section, group_key)
);
create index if not exists idx_hr_hiring_report_manual_entries_period on hr_hiring_report_manual_entries(period_type, period_key);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function hr_hiring_report_manual_entries_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_hr_hiring_report_manual_entries_stamp on hr_hiring_report_manual_entries;
create trigger trg_hr_hiring_report_manual_entries_stamp before insert or update on hr_hiring_report_manual_entries
  for each row execute function hr_hiring_report_manual_entries_stamp();

-- ---------- RLS: company-scoped, same pattern as csr_teams (0031) ----------
alter table hr_hiring_report_manual_entries enable row level security;
alter table hr_hiring_report_manual_entries force row level security;

drop policy if exists hr_hiring_report_manual_entries_select on hr_hiring_report_manual_entries;
create policy hr_hiring_report_manual_entries_select on hr_hiring_report_manual_entries
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_hiring_report_manual_entries_insert on hr_hiring_report_manual_entries;
create policy hr_hiring_report_manual_entries_insert on hr_hiring_report_manual_entries
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_hiring_report_manual_entries_update on hr_hiring_report_manual_entries;
create policy hr_hiring_report_manual_entries_update on hr_hiring_report_manual_entries
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_hiring_report_manual_entries_delete on hr_hiring_report_manual_entries;
create policy hr_hiring_report_manual_entries_delete on hr_hiring_report_manual_entries
  for delete using (company_id = auth_company_id() or is_superadmin());
