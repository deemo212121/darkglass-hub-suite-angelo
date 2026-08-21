-- =====================================================================
-- 0184 — Track when a mileage entry's payroll hold was last CLEARED, not
-- just whether it's currently held.
--
-- Releasing a hold (setMileageEntryPayrollExcluded/reconcileMileageNoPhotoHolds
-- in mileage.ts) has always nulled out payroll_excluded_at/payroll_hold_reason
-- on release, leaving no trace a ticket was ever held once it clears — so
-- there was nothing for the mobile "Updated" sub-tab (On Hold Tickets) to
-- query. This column is the opposite of payroll_excluded_at: set to now()
-- the moment payroll_excluded flips true -> false, cleared again if the
-- entry ever gets re-held.
--
-- Run once in the Supabase SQL Editor, after 0183.
-- =====================================================================

alter table mileage_entries add column if not exists payroll_released_at timestamptz;
