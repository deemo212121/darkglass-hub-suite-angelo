-- =====================================================================
-- 0024_role_codes_expand.sql
--
-- Expand the role check on profiles.role so the newer role codes the
-- UI can now select are actually storable:
--
--   • TRIAGE_USER, TRIAGE_MANAGER   — added in 0020 but the constraint
--                                     from 0014 never listed them.
--   • TECHNICIAN_MANAGER            — new supervisor role for the tech
--                                     team, added Jul 2026.
--
-- Rewrites the constraint from 0014 verbatim, appending the new codes.
-- The legacy Title-Case labels stay valid so any historic rows created
-- before 0014 still pass.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles drop constraint if exists profiles_role_check;

alter table profiles add constraint profiles_role_check
  check (role in (
    -- Canonical base codes
    'SUPERADMIN','ADMIN','MANAGER','CSR','TECHNICIAN','TECHNICIAN_MANAGER',
    'DISPATCHER','CLAIMS','HR','IT','PARTS','FINANCE',
    -- Extended codes
    'CSR_AGENT','CSR_TEAM_LEADER','CSR_MANAGER',
    'BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
    'CLAIMS_MANAGER','PARTS_MANAGER',
    'BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER',
    'TRIAGE_USER','TRIAGE_MANAGER',
    -- Legacy Title Case labels (back-compat)
    'CSR Agent','CSR Team Leader','CSR Manager',
    'Branch Manager','Senior Branch Manager',
    'Claims Manager','Parts Manager',
    'BizOps Manager','BizOps Senior Manager'
  ));
