-- Widens hr_onboarding_document_columns' group_key check constraint (0081)
-- to also allow the New Onboarding Documents tab's 4 groups
-- (TECHNICIAN_STAFF/BRANCH_MANAGER_UP/OFFICE_STAFF_US/PHILIPPINES_STAFF) —
-- a separate role split from the original tab's TECHNICIAN/PARTS_MANAGER/
-- PH, kept in the same table (custom columns are just per-group free text
-- either way) but distinct group_key values so the two tabs' custom
-- columns never mix.

alter table hr_onboarding_document_columns drop constraint if exists hr_onboarding_document_columns_group_key_check;
alter table hr_onboarding_document_columns add constraint hr_onboarding_document_columns_group_key_check
  check (group_key in ('TECHNICIAN', 'PARTS_MANAGER', 'PH', 'TECHNICIAN_STAFF', 'BRANCH_MANAGER_UP', 'OFFICE_STAFF_US', 'PHILIPPINES_STAFF'));
