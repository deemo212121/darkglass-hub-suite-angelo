-- =====================================================================
-- 0102_add_senior_manager_parts_team_leader.sql
--
-- Adds two new role codes:
--   - SENIOR_MANAGER: a generic senior-manager tier, sibling to MANAGER the
--     same way BIZOPS_SENIOR_MANAGER relates to BIZOPS_MANAGER (not branch-
--     or department-specific).
--   - PARTS_TEAM_LEADER: a team-leader tier for the Parts department, same
--     relationship as CSR_TEAM_LEADER to CSR_MANAGER/CSR_AGENT.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in (
    -- Canonical base codes
    'SUPERSUPERADMIN','SUPERADMIN','ADMIN','MANAGER','SENIOR_MANAGER','CSR','TECHNICIAN','TECHNICIAN_MANAGER',
    'DISPATCHER','CLAIMS','HR','IT','PARTS','FINANCE',
    -- Extended codes
    'CSR_AGENT','CSR_TEAM_LEADER','CSR_MANAGER',
    'BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
    'CLAIMS_MANAGER','PARTS_MANAGER','PARTS_TEAM_LEADER',
    'BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER',
    'TRIAGE_USER','TRIAGE_MANAGER',
    'TECHNICAL_DIRECTOR',
    'TECHNICAL_ASSISTANT_DIRECTOR','CLAIMS_TEAM_LEADER',
    -- Legacy Title Case labels (back-compat)
    'CSR Agent','CSR Team Leader','CSR Manager',
    'Branch Manager','Senior Branch Manager',
    'Claims Manager','Parts Manager',
    'BizOps Manager','BizOps Senior Manager'
  ));

-- messages_insert (0100_platform_admin_data_lockdown.sql): the announcement-
-- posting gate checks the caller's role directly (not via a client-side
-- role list) — add SENIOR_MANAGER alongside the existing MANAGER so it
-- gets the same announcement-posting privilege.
drop policy if exists messages_insert on messages;
create policy messages_insert on messages
  for insert with check (
    company_id = auth_company_id()
    and (
      is_announcement = false
      or exists (
        select 1 from profiles p
        where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
          and p.role in ('SUPERADMIN','ADMIN','MANAGER','SENIOR_MANAGER','HR')
      )
    )
  );

-- Run once in the Supabase SQL Editor.
-- =====================================================================
