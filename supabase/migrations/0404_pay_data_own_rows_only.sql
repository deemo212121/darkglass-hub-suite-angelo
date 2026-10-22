-- =====================================================================
-- 0404 — Pay data: employees see only their own rows; only Admin /
--         Finance / SuperAdmin can change them
--
-- These four tables let ANY signed-in employee of the company read every
-- row — and three of them let any employee add, change or delete rows —
-- straight from the browser (dev tools), even though only Admin/Finance
-- can open the pages that show them:
--
--   tech_custom_pay_items      technicians' pay lines (tickets, bonuses,
--                              mileage, deductions)
--   payroll_review_breakdowns  reviewed pay per person per period
--                              (writes were already Admin/Finance only)
--   tech_tax_lines             technicians' tax withholdings
--   payroll_adjustments        office/PH reimbursements, deductions, tax
--
-- After this:
--   read   — your own rows (Self-Service → My Payroll → Pay details), or
--            every row in your company for Admin / Finance / SuperAdmin
--            (secondary roles count — is_admin()/is_finance()/
--            is_company_superadmin() check extra_roles too)
--   write  — Admin / Finance / SuperAdmin only
--
-- Who reads/writes these in the app today — all keep working:
--   Accounting Dashboard (Payroll, Tech Activity Report, Payroll Disputes,
--   Reviewed Periods, Payroll History) — Admin/Finance only; and
--   Self-Service → My Payroll → Pay details — the employee's own rows.
-- Same pattern as payroll_employee_notes (0399).
--
-- Run once in the Supabase SQL Editor, after 0403. Safe to run again.
-- (janeyyy16's 0403, renumbered — this repo's 0403 is tickets_squaretrade_url.)
--
-- NOTE (rulonajhon, 2026-10-21): Accounting Dashboard is also open to IT and
-- TECHNICAL_DIRECTOR by an Accessibility override (Daven Hodge); those roles
-- are not in is_admin()/is_finance(), so they'd see only their own rows here.
-- =====================================================================

-- ---------- tech_custom_pay_items ----------
drop policy if exists tech_custom_pay_items_select on tech_custom_pay_items;
create policy tech_custom_pay_items_select on tech_custom_pay_items
  for select using (
    profile_id = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists tech_custom_pay_items_insert on tech_custom_pay_items;
create policy tech_custom_pay_items_insert on tech_custom_pay_items
  for insert with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists tech_custom_pay_items_update on tech_custom_pay_items;
create policy tech_custom_pay_items_update on tech_custom_pay_items
  for update
  using ((company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin())) or is_superadmin())
  with check ((company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin())) or is_superadmin());

drop policy if exists tech_custom_pay_items_delete on tech_custom_pay_items;
create policy tech_custom_pay_items_delete on tech_custom_pay_items
  for delete using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

-- ---------- payroll_review_breakdowns (writes already Admin/Finance only) ----------
drop policy if exists payroll_review_breakdowns_select on payroll_review_breakdowns;
create policy payroll_review_breakdowns_select on payroll_review_breakdowns
  for select using (
    profile_id = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

-- ---------- tech_tax_lines ----------
drop policy if exists tech_tax_lines_select on tech_tax_lines;
create policy tech_tax_lines_select on tech_tax_lines
  for select using (
    profile_id = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists tech_tax_lines_insert on tech_tax_lines;
create policy tech_tax_lines_insert on tech_tax_lines
  for insert with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists tech_tax_lines_update on tech_tax_lines;
create policy tech_tax_lines_update on tech_tax_lines
  for update
  using ((company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin())) or is_superadmin())
  with check ((company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin())) or is_superadmin());

drop policy if exists tech_tax_lines_delete on tech_tax_lines;
create policy tech_tax_lines_delete on tech_tax_lines
  for delete using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

-- ---------- payroll_adjustments ----------
drop policy if exists payroll_adjustments_select on payroll_adjustments;
create policy payroll_adjustments_select on payroll_adjustments
  for select using (
    profile_id = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists payroll_adjustments_insert on payroll_adjustments;
create policy payroll_adjustments_insert on payroll_adjustments
  for insert with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists payroll_adjustments_update on payroll_adjustments;
create policy payroll_adjustments_update on payroll_adjustments
  for update
  using ((company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin())) or is_superadmin())
  with check ((company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin())) or is_superadmin());

drop policy if exists payroll_adjustments_delete on payroll_adjustments;
create policy payroll_adjustments_delete on payroll_adjustments
  for delete using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

-- Check: the policies now on these four tables.
select tablename, policyname, cmd
from pg_policies
where tablename in ('tech_custom_pay_items', 'payroll_review_breakdowns', 'tech_tax_lines', 'payroll_adjustments')
order by tablename, cmd;
