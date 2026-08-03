-- =====================================================================
-- 0087_role_codes_expand2.sql
--
-- Expand the role check on profiles.role again — two role codes the
-- User Management "User Type" picker can now select were never added to
-- the constraint (extra_roles has no such constraint, so picking one as
-- a secondary role already worked; only primary was ever blocked):
--
--   • TECHNICAL_ASSISTANT_DIRECTOR
--   • CLAIMS_TEAM_LEADER
--
-- (TECHNICAL_DIRECTOR was already added in 0086_role_codes_add_technical_director.sql.)
--
-- Rewrites the constraint verbatim, appending the new codes.
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
    'TECHNICAL_DIRECTOR',
    -- New in this migration
    'TECHNICAL_ASSISTANT_DIRECTOR','CLAIMS_TEAM_LEADER',
    -- Legacy Title Case labels (back-compat)
    'CSR Agent','CSR Team Leader','CSR Manager',
    'Branch Manager','Senior Branch Manager',
    'Claims Manager','Parts Manager',
    'BizOps Manager','BizOps Senior Manager'
  ));
