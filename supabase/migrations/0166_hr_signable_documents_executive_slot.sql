-- =====================================================================
-- 0166 — Add 'executive' to hr_signable_documents.recipient_slot.
--
-- The new Employee Promotion / Role Change form (ReportHRDaily.tsx,
-- promotionFormTemplate.ts) routes through 5 signers — Employee, Direct
-- Manager, Senior Manager, HR, Executive — one more than the Employee
-- Warning Form's 4 (employee/manager/senior_manager/hr_staff, see 0050).
-- Same shared hr_signable_documents table/workflow, just widening the
-- allowed slot values so 'executive' can be used as a recipient_slot.
--
-- Run once in the Supabase SQL Editor, after 0165.
-- =====================================================================

alter table hr_signable_documents drop constraint if exists hr_signable_documents_recipient_slot_check;
alter table hr_signable_documents add constraint hr_signable_documents_recipient_slot_check
  check (recipient_slot in ('employee', 'manager', 'senior_manager', 'hr_staff', 'executive'));
