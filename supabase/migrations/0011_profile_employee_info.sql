-- =====================================================================
-- 0011 — Profile Employee Information (bank, personal, home address)
-- Stores the user-detail "Employee Information" tab on the profile so it
-- persists company-wide (was localStorage-only) and the Work Map can read
-- each technician's HOME ADDRESS to pin their house. Company-scoped via the
-- existing profiles RLS.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles
  add column if not exists employee_info jsonb default '{}'::jsonb;

-- employee_info shape (all optional):
-- {
--   bankName, routingNumber, accountNumber,
--   address1, address2, city, state, zipCode,
--   employeeId, employeeSsn, employeeSalary,
--   birthDate, hireDate, terminateDate, employeeNote,
--   photoName, photoDataUrl
-- }
