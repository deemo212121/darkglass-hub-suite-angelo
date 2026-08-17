-- =====================================================================
-- 0170 — profiles.role: add PARTS_ORDER
--
-- profiles.role is guarded by a `profiles_role_check` CHECK constraint
-- (see 0102_add_senior_manager_parts_team_leader.sql for the last tracked
-- redefinition) that must explicitly list every allowed value — a profile
-- can't be saved with role = 'PARTS_ORDER' until it's added here (confirmed
-- live: PATCHing a real profile's role to 'PARTS_ORDER' fails with
-- "violates check constraint profiles_role_check").
--
-- Note: SENIOR_DIRECTOR and ASSISTANT_MANAGER (both already in ROLE_LABELS,
-- src/lib/roleLabels.ts) were found to already be accepted by the LIVE
-- constraint despite no tracked migration ever adding them — the
-- constraint drifted from this repo's migration history at some point.
-- This redefinition is sourced from the current ROLE_LABELS (the real
-- source of truth) rather than patched on top of 0102's list, so it's
-- correct regardless of that drift, and self-heals it going forward.
--
-- Run once in the Supabase SQL Editor, after 0169.
-- =====================================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in (
    -- Canonical codes (current ROLE_LABELS, src/lib/roleLabels.ts)
    'SUPERSUPERADMIN','SUPERADMIN','ADMIN','MANAGER','SENIOR_MANAGER','CSR','TECHNICIAN','TECHNICIAN_MANAGER',
    'DISPATCHER','HR','IT','PARTS','FINANCE','CLAIMS',
    'CSR_AGENT','CSR_TEAM_LEADER','CSR_MANAGER',
    'BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
    'CLAIMS_MANAGER','CLAIMS_TEAM_LEADER',
    'PARTS_MANAGER','PARTS_TEAM_LEADER','PARTS_ORDER',
    'BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER',
    'TRIAGE_USER','TRIAGE_MANAGER',
    'TECHNICAL_DIRECTOR','TECHNICAL_ASSISTANT_DIRECTOR',
    'SENIOR_DIRECTOR','ASSISTANT_MANAGER',
    -- Legacy Title Case labels (back-compat, carried forward from 0102)
    'CSR Agent','CSR Team Leader','CSR Manager',
    'Branch Manager','Senior Branch Manager',
    'Claims Manager','Parts Manager',
    'BizOps Manager','BizOps Senior Manager'
  ));
