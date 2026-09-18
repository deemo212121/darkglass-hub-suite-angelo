-- =====================================================================
-- 0272 — Add 'executive_2' to hr_signable_documents.recipient_slot.
--
-- Employee Promotion / Role Change form now supports TWO sequential
-- Executive signers (both must sign, one after the other — HR routes
-- to the first, then once they've signed, sends it on to the second the
-- same way it already routes between every other slot) instead of just
-- one. Same shared hr_signable_documents table/workflow every other
-- document type uses — see 0166 for the original single 'executive'
-- slot this widens further.
--
-- Run once in the Supabase SQL Editor, after 0271.
-- =====================================================================

alter table hr_signable_documents drop constraint if exists hr_signable_documents_recipient_slot_check;
alter table hr_signable_documents add constraint hr_signable_documents_recipient_slot_check
  check (recipient_slot in ('employee', 'manager', 'senior_manager', 'hr_staff', 'executive', 'executive_2'));
