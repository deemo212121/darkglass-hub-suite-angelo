-- =====================================================================
-- 0270 — CSR Daily Report (the editable per-agent worksheet on the new
-- CSR module's "Daily Report" page — src/components/CSRTeamDailyReport.tsx).
--
-- One row per (profile_id, report_date): everything on it that isn't
-- already fetched live from elsewhere (Full Name/Start Date from
-- profiles+employee_info, Month computed from Start Date, Sick Day/
-- Vacation Day balances from pto_requests via src/lib/supabase/pto.ts,
-- team/roster from csr_teams/csr_team_members — migration 0031) — the
-- rest (Rate, Task, GH, Total, Schedule, Attempt, Update, Mistake,
-- Warning, Abs/Em., hr) is typed in by hand each day, same as the
-- original spreadsheet this page replaces.
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — identical pattern to csr_teams/csr_team_members (0031).
-- Run once in the Supabase SQL Editor, after 0269.
-- =====================================================================

create table if not exists csr_daily_report_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  report_date   date not null,
  rate          numeric,
  task          text,
  gh            numeric,
  total         numeric,
  schedule      numeric,
  attempt       numeric,
  update_count  numeric,
  mistake       text,
  warning       text,
  abs_em        text,
  hr            numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (profile_id, report_date)
);
create index if not exists idx_csr_daily_report_entries_company on csr_daily_report_entries(company_id);
create index if not exists idx_csr_daily_report_entries_date on csr_daily_report_entries(report_date);

-- ---------- Auto-stamp company_id, keep updated_at current ----------
create or replace function csr_daily_report_entries_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_csr_daily_report_entries_stamp on csr_daily_report_entries;
create trigger trg_csr_daily_report_entries_stamp before insert or update on csr_daily_report_entries
  for each row execute function csr_daily_report_entries_stamp();

-- ---------- RLS: company-scoped, same pattern as csr_teams (0031) ----------
alter table csr_daily_report_entries enable row level security;
alter table csr_daily_report_entries force row level security;

drop policy if exists csr_daily_report_entries_select on csr_daily_report_entries;
create policy csr_daily_report_entries_select on csr_daily_report_entries
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_daily_report_entries_insert on csr_daily_report_entries;
create policy csr_daily_report_entries_insert on csr_daily_report_entries
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_daily_report_entries_update on csr_daily_report_entries;
create policy csr_daily_report_entries_update on csr_daily_report_entries
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists csr_daily_report_entries_delete on csr_daily_report_entries;
create policy csr_daily_report_entries_delete on csr_daily_report_entries
  for delete using (company_id = auth_company_id() or is_superadmin());
