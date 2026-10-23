-- =====================================================================
-- 0405 — New role: SALES_MANAGER ("Sales Manager"), Philippines-based,
-- in a new "Sales" department (src/lib/roleLabels.ts).
--
-- No role constraint to widen: profiles_role_check was dropped in 0209
-- (custom roles), so profiles can already hold the new code.
--
-- chain_department (0337, last replaced in 0380): SALES_MANAGER maps to
-- "Sales" instead of "Other", so the PH approval chain files them under
-- their own department. chain_department_manager_roles is deliberately
-- NOT changed — Sales has no default approver role, so a Sales Manager is
-- not an approver and their requests go to the top level, unless an Admin
-- names Sales department managers in the PH approval chain panel
-- (ph_department_managers).
--
-- Replaces one function with the same signature — no data is touched.
-- Run once in the Supabase SQL Editor, after 0404.
-- =====================================================================

create or replace function chain_department(p_role text)
returns text language sql immutable as $$
  select case upper(coalesce(p_role, ''))
    when 'CSR' then 'CSR' when 'CSR_AGENT' then 'CSR' when 'CSR_TEAM_LEADER' then 'CSR' when 'CSR_MANAGER' then 'CSR'
    when 'CLAIMS' then 'Claims' when 'CLAIMS_TEAM_LEADER' then 'Claims' when 'CLAIMS_MANAGER' then 'Claims'
    when 'PARTS' then 'Parts' when 'PARTS_ORDER' then 'Parts' when 'PARTS_TEAM_LEADER' then 'Parts' when 'PARTS_MANAGER' then 'Parts'
    when 'BIZOPS_ASSOCIATE' then 'BizOps' when 'BIZOPS_TEAM_LEADER' then 'BizOps'
    when 'BIZOPS_MANAGER' then 'BizOps' when 'BIZOPS_SENIOR_MANAGER' then 'BizOps'
    when 'TRIAGE_USER' then 'Triage' when 'TRIAGE_MANAGER' then 'Triage'
    when 'SALES_MANAGER' then 'Sales'
    when 'MANAGER' then 'Management' when 'SENIOR_MANAGER' then 'Management'
    when 'FINANCE' then 'Accounting'
    when 'HR' then 'HR'
    when 'IT' then 'IT'
    when 'DISPATCHER' then 'Dispatch'
    when 'TECHNICIAN' then 'Technician' when 'TECHNICIAN_MANAGER' then 'Technician'
    when 'TECHNICAL_DIRECTOR' then 'Technician' when 'TECHNICAL_ASSISTANT_DIRECTOR' then 'Technician'
    when 'BRANCH_MANAGER' then 'Technician' when 'SENIOR_BRANCH_MANAGER' then 'Technician'
    else 'Other'
  end;
$$;
