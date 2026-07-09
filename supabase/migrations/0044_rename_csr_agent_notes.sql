-- =====================================================================
-- 0044 — Rename csr_agent_notes -> employee_conduct_notes
--
-- Ported from upstream (janeyyy16/usapp)'s 0032_rename_csr_agent_notes.sql,
-- renumbered to 0044 (see 0040_csr_agent_notes.sql for why).
--
-- This table stopped being CSR-specific once 0042/the app-level changes
-- generalized it to every department (any manager-flavored role can
-- submit a note about any employee; HR is the final approver company-
-- wide). The name was left over from when it started as a CSR-only
-- feature — this migration renames the table and its dependent objects
-- to something that doesn't imply CSR-only scope.
--
-- Nothing about the shape or behavior changes — same columns, same RLS,
-- same two-stage review trigger from 0043, just renamed. Historical
-- migrations 0040-0043 are left untouched (they're an accurate record of
-- what was run against the table under its old name at the time).
--
-- Run once in the Supabase SQL Editor, after 0043.
-- =====================================================================

alter table csr_agent_notes rename to employee_conduct_notes;
alter table employee_conduct_notes rename column agent_profile_id to employee_profile_id;

alter table employee_conduct_notes rename constraint csr_agent_notes_status_check to employee_conduct_notes_status_check;

alter index idx_csr_agent_notes_company rename to idx_employee_conduct_notes_company;
alter index idx_csr_agent_notes_agent rename to idx_employee_conduct_notes_employee;
alter index idx_csr_agent_notes_status rename to idx_employee_conduct_notes_status;

alter policy csr_agent_notes_select on employee_conduct_notes rename to employee_conduct_notes_select;
alter policy csr_agent_notes_insert on employee_conduct_notes rename to employee_conduct_notes_insert;
alter policy csr_agent_notes_update on employee_conduct_notes rename to employee_conduct_notes_update;
alter policy csr_agent_notes_delete on employee_conduct_notes rename to employee_conduct_notes_delete;

alter trigger trg_csr_agent_notes_stamp on employee_conduct_notes rename to trg_employee_conduct_notes_stamp;
alter trigger trg_csr_agent_notes_review on employee_conduct_notes rename to trg_employee_conduct_notes_review;

-- Trigger definitions reference functions by OID, not name, so renaming
-- these is safe and needs no trigger recreation.
alter function csr_agent_notes_stamp_company() rename to employee_conduct_notes_stamp_company;
alter function csr_agent_notes_stamp_review() rename to employee_conduct_notes_stamp_review;
