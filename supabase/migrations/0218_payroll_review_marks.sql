-- =====================================================================
-- 0218 — payroll_review_marks: "this technician's payroll has been
-- reviewed for this period."
--
-- The Accounting Dashboard's Office Payroll tab now walks Finance through a
-- per-technician review wizard (attendance detail -> Tech Activity Report ->
-- Done). Hitting "Done" stamps a row here for (technician, pay period), and
-- the Office Payroll table shows a "Reviewed ✓" badge for that row. It's a
-- pre-Generate-Payroll checklist aid, not a gate — Generate Payroll ignores
-- it entirely.
--
-- Period-scoped: the mark is keyed by (period_start, period_end), so it
-- clears the moment Finance picks a different pay period, and re-reviewing
-- just re-stamps reviewed_at/reviewed_by.
--
-- RLS mirrors dashboardAccess.ts's "accounting-dashboard": ["ADMIN",
-- "FINANCE"] (plus the company-scoped SUPERADMIN tier, same as every other
-- accounting write) — read is company-wide so a payslip/report view can
-- show the badge too.
--
-- Run once in the Supabase SQL Editor, after 0217.
-- =====================================================================

create table if not exists payroll_review_marks (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  profile_id       uuid not null references profiles(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  reviewed_by      uuid references profiles(id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz not null default now(),
  unique (company_id, profile_id, period_start, period_end)
);

create index if not exists idx_payroll_review_marks_company_period
  on payroll_review_marks (company_id, period_start, period_end);

create or replace function payroll_review_marks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payroll_review_marks_stamp on payroll_review_marks;
create trigger trg_payroll_review_marks_stamp before insert or update on payroll_review_marks
  for each row execute function payroll_review_marks_stamp();

-- ---------- RLS ----------
alter table payroll_review_marks enable row level security;
alter table payroll_review_marks force row level security;

drop policy if exists payroll_review_marks_select on payroll_review_marks;
create policy payroll_review_marks_select on payroll_review_marks
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists payroll_review_marks_write on payroll_review_marks;
create policy payroll_review_marks_write on payroll_review_marks
  for all
  using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );
