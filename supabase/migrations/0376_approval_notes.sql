-- =====================================================================
-- 0376 — Approval notes: Manager / HR / Accounting notes on every decision.
--
-- Approving or rejecting a PTO / Sick / Unpaid leave request, a Time
-- Correction, or a Ticket Time Dispute now requires a note from whoever
-- decides. Each stage keeps its own note so the Status column can show
--   Manager: Approved — "note"
--   HR: Approved — "note"
--   Accounting: Approved — "note"
-- (review_note stays the employee-facing rejection log, unchanged.)
--
-- Ticket Time Disputes are a single decision (status) plus HR's paperwork
-- sign-off: the decision's note stays in review_note, HR's goes in hr_note.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table pto_requests add column if not exists manager_note text;
alter table pto_requests add column if not exists hr_note text;
alter table pto_requests add column if not exists accounting_note text;

alter table timecard_corrections add column if not exists manager_note text;
alter table timecard_corrections add column if not exists hr_note text;
alter table timecard_corrections add column if not exists accounting_note text;

alter table employee_requests add column if not exists hr_note text;

-- Existing manager comments from signed Exception Reports become the manager's note.
update pto_requests set manager_note = manager_comments where manager_note is null and coalesce(manager_comments, '') <> '';
update timecard_corrections set manager_note = manager_comments where manager_note is null and coalesce(manager_comments, '') <> '';

-- Accounting signs too (like the Manager): approving an exception-report
-- PTO / Sick / Unpaid request or Time Correction as Accounting takes
-- required Accounting Comments (accounting_note) + a signature, stamped in
-- the PDF's "7. Accounting Approval" section.
alter table pto_requests add column if not exists accounting_signature_url text;
alter table pto_requests add column if not exists accounting_signature_name text;
alter table pto_requests add column if not exists accounting_signed_at timestamptz;

alter table timecard_corrections add column if not exists accounting_signature_url text;
alter table timecard_corrections add column if not exists accounting_signature_name text;
alter table timecard_corrections add column if not exists accounting_signed_at timestamptz;
