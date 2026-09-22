-- =====================================================================
-- 0299 — technician_daily_performance_overrides: per-technician,
-- per-DAY manual corrections to the Technician Performance Report
-- (TechnicianPerformanceReport.tsx), which otherwise computes every KPI
-- live from tickets/mileage/timecards (see that file's own header
-- comment — deliberately not a new source of truth). Some days need a
-- human correction on top of that (a ticket logged under the wrong
-- name, a mileage entry missed entirely, etc.) — rather than editing
-- the underlying ticket/mileage/timecard data (which would also change
-- payroll, dispatch, and every other report built on it), this table
-- lets HR/Finance override just the 3 RAW per-day figures this report's
-- KPIs are built from. Every derived figure (Redo Rate %, Miles/Ticket,
-- Tickets/Hour, the 3 threshold alerts) is still computed FROM the
-- period's summed totals — never stored directly.
--
-- Deliberately keyed by a single calendar DATE, not a period range like
-- payroll_hourly_ot_overrides (0289)/payroll_review_marks (0218) — this
-- report's Weekly/Monthly/Custom period is just a client-side date-range
-- picker over the same underlying daily data (mileage_entries already
-- works this way; see mileageDaily in TechnicianPerformanceReport.tsx),
-- so a period-scoped override would silently stop applying (or apply
-- partially) the moment someone picked a different or overlapping range
-- covering the same days. A per-day row always sums correctly into
-- whatever range currently contains it.
--
-- A null column here means "no correction for this day/figure — keep
-- the live computed value." (Redo Count was originally left out of this
-- table — see migration 0300, which adds it back with different
-- semantics, since it has no day-level breakdown in this report's own
-- data pipeline the way the 3 columns below do.)
--
-- Run once in the Supabase SQL Editor, after 0298.
-- =====================================================================

create table if not exists technician_daily_performance_overrides (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  work_date     date not null,
  total_tickets numeric,
  miles         numeric,
  hours_worked  numeric,
  set_by        uuid references profiles(id) on delete set null,
  set_by_name   text,
  set_at        timestamptz not null default now(),
  unique (company_id, profile_id, work_date)
);

create index if not exists idx_technician_daily_performance_overrides_company_date
  on technician_daily_performance_overrides (company_id, work_date);

create or replace function technician_daily_performance_overrides_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.set_at := now();
  return new;
end;
$$;

drop trigger if exists trg_technician_daily_performance_overrides_stamp on technician_daily_performance_overrides;
create trigger trg_technician_daily_performance_overrides_stamp before insert or update on technician_daily_performance_overrides
  for each row execute function technician_daily_performance_overrides_stamp();

-- ---------- RLS ----------
-- Same shape as payroll_hourly_ot_overrides (0289): company-wide read
-- (every viewer of the report needs the corrected numbers, not just
-- whoever set them), ADMIN/FINANCE/company-SUPERADMIN write.
alter table technician_daily_performance_overrides enable row level security;
alter table technician_daily_performance_overrides force row level security;

drop policy if exists technician_daily_performance_overrides_select on technician_daily_performance_overrides;
create policy technician_daily_performance_overrides_select on technician_daily_performance_overrides
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists technician_daily_performance_overrides_write on technician_daily_performance_overrides;
create policy technician_daily_performance_overrides_write on technician_daily_performance_overrides
  for all
  using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );
