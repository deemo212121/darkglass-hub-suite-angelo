-- =====================================================================
-- 0209 — Soft-delete for mileage_entries
--
-- The Mileage tab's Trash icon used to hard-delete a row outright (no
-- reason captured, no way back). This adds a soft-delete instead: the row
-- stays exactly where it is (still visible in the table, its Payroll
-- status column now reads "Deleted" instead of On Hold/Included), records
-- who deleted it and why, and can be restored with one click.
--
-- Deliberately separate from payroll_excluded ("On Hold") — that flag is
-- for a stop the technician DID drive to, but that shouldn't count for
-- payroll yet; it stays in the day's route/mileage total either way.
-- deleted_at is for a stop the technician never actually made (customer
-- cancelled, couldn't get there, etc.), so it comes OUT of the route and
-- mileage total entirely. getTechCompletedRepairCounts (techPayroll.ts)
-- keeps reading payroll_excluded only — deleting a mileage entry never
-- changes whether the underlying ticket's repair pay counts; that's driven
-- by the ticket's own status, a separate concern from this mileage record.
--
-- Run once in the Supabase SQL Editor, after 0208.
-- =====================================================================

alter table mileage_entries
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id) on delete set null,
  add column if not exists deleted_by_name text,
  add column if not exists delete_reason text;

create index if not exists idx_mileage_entries_deleted_at on mileage_entries(deleted_at) where deleted_at is not null;
