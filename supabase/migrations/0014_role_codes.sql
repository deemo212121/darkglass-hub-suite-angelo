-- =====================================================================
-- 0014_role_codes.sql
--
-- The frontend now stores roles as snake-case UPPERCASE codes
-- (CSR_AGENT, BIZOPS_MANAGER, …) instead of the Title Case labels added
-- in 0006. This migration replaces profiles_role_check with the new set
-- of codes, keeping the legacy labels valid too so existing rows still
-- pass the constraint until they're migrated.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles drop constraint if exists profiles_role_check;

alter table profiles add constraint profiles_role_check
  check (role in (
    -- Canonical base codes
    'SUPERADMIN','ADMIN','MANAGER','CSR','TECHNICIAN','DISPATCHER',
    'CLAIMS','HR','IT','PARTS','FINANCE',
    -- New snake-case extended codes (sent by the UI today)
    'CSR_AGENT','CSR_TEAM_LEADER','CSR_MANAGER',
    'BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
    'CLAIMS_MANAGER','PARTS_MANAGER',
    'BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER',
    -- Legacy Title Case labels (kept for back-compat with rows created
    -- before this migration). Safe to drop once all rows are normalized.
    'CSR Agent','CSR Team Leader','CSR Manager',
    'Branch Manager','Senior Branch Manager',
    'Claims Manager','Parts Manager',
    'BizOps Manager','BizOps Senior Manager'
  ));
