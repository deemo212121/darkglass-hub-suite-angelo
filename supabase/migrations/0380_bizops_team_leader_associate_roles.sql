-- =====================================================================
-- 0380 — New roles: BIZOPS_TEAM_LEADER ("BizOps Team Leader") and
-- BIZOPS_ASSOCIATE ("BizOps Associate"), below BIZOPS_MANAGER /
-- BIZOPS_SENIOR_MANAGER — the same Manager → Team Leader → Associate
-- ladder as CSR, Parts and Claims (src/lib/roleLabels.ts).
--
-- No role constraint to widen: profiles_role_check was dropped in 0209
-- (custom roles), so profiles can already hold the new codes.
--
--   1. chain_department (0337): both map to the BizOps department, so a
--      PH BizOps Team Leader's / Associate's requests route to the BizOps
--      managers like everyone else in BizOps.
--   2. is_csr_wide_visibility (0093): both see every Live Chat session, as
--      BizOps Managers do (they're on the Live Chat dashboard too).
--
-- Replaces two functions with the same signatures — no data is touched.
-- Run once in the Supabase SQL Editor, after 0379.
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

create or replace function is_csr_wide_visibility()
returns boolean language sql stable security definer set search_path = public as $$
  select
    upper(role) in ('ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER', 'BIZOPS_TEAM_LEADER', 'BIZOPS_ASSOCIATE')
    or exists (
      select 1 from unnest(coalesce(extra_roles, '{}')) r
      where upper(r) in ('ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'BIZOPS_MANAGER', 'BIZOPS_SENIOR_MANAGER', 'BIZOPS_TEAM_LEADER', 'BIZOPS_ASSOCIATE')
    )
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;
