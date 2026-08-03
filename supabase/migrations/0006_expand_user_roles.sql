-- =====================================================================
-- Expand the allowed profile roles / user types.
-- Adds finer-grained job titles used by the org alongside the base roles.
-- Run once in the Supabase SQL Editor.
--
-- NOTE: Access control (RLS, route guards) keys off the BASE roles
-- (SUPERADMIN/ADMIN/MANAGER/CSR/TECHNICIAN/CLAIMS/HR/IT/PARTS/FINANCE).
-- The new titles below are organizational labels; if any should grant
-- elevated access, update the relevant role checks accordingly.
-- =====================================================================

alter table profiles drop constraint if exists profiles_role_check;

alter table profiles add constraint profiles_role_check
  check (role in (
    'SUPERADMIN','ADMIN','MANAGER','CSR','TECHNICIAN','CLAIMS','HR','IT','PARTS','FINANCE',
    'CSR Agent','CSR Team Leader','CSR Manager','Senior Branch Manager',
    'Claims Manager','Parts Manager','BizOps Manager','BizOps Senior Manager','Branch Manager'
  ));
