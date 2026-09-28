-- =====================================================================
-- 0323 — Car IQ History (AccountingDashboard.tsx's Car IQ tab) — an
-- effective-dated log of a technician's Car IQ on/off status, mirroring
-- salary_entries' own effective-dated pattern for hourly rate ("Start Date"
-- is editable after the fact for a backdated entry, same as Salary
-- History's "Effective Date" — see updateCarIqHistoryEffectiveDate). Also
-- carries changed_by_name (salary_entries' own created_by_name equivalent),
-- shown as the tab's "Modified By" column. Toggling Car IQ on the Car IQ
-- tab now inserts a new dated row here (via setEmployeeHasCarIq) instead of
-- only flipping employee_info.hasCarIq's single flag — that flag stays as
-- the fast "is it on right now" read used everywhere else (eligibility
-- filters, the tab's own toggle display), while this table is what a
-- payroll period reads to detect a mid-period switch and apply the right
-- mileage rate to each side of it (see carIqSwitch in AccountingDashboard.tsx).
--
-- Company-scoped via RLS, company_id auto-stamped from the caller's
-- session — same pattern as csr_daily_report_entries (0275); reuses that
-- migration's csr_daily_report_extras_stamp() trigger function (a plain
-- company_id/updated_at stamp, despite the CSR-specific name).
-- Run once in the Supabase SQL Editor, after 0318.
-- =====================================================================

create table if not exists car_iq_history (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  profile_id       uuid not null references profiles(id) on delete cascade,
  effective_date   date not null,
  has_car_iq       boolean not null,
  changed_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (profile_id, effective_date)
);
create index if not exists idx_car_iq_history_company on car_iq_history(company_id);
create index if not exists idx_car_iq_history_profile on car_iq_history(profile_id);

drop trigger if exists trg_car_iq_history_stamp on car_iq_history;
create trigger trg_car_iq_history_stamp before insert or update on car_iq_history
  for each row execute function csr_daily_report_extras_stamp();

-- ---------- RLS: company-scoped, same pattern as salary_entries ----------
alter table car_iq_history enable row level security;
alter table car_iq_history force row level security;

drop policy if exists car_iq_history_select on car_iq_history;
create policy car_iq_history_select on car_iq_history
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists car_iq_history_insert on car_iq_history;
create policy car_iq_history_insert on car_iq_history
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists car_iq_history_update on car_iq_history;
create policy car_iq_history_update on car_iq_history
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists car_iq_history_delete on car_iq_history;
create policy car_iq_history_delete on car_iq_history
  for delete using (company_id = auth_company_id() or is_superadmin());
