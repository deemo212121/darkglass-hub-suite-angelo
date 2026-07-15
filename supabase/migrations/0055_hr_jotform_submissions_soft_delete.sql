-- =====================================================================
-- 0055 — Soft delete for Jotform Document submissions
--
-- "Delete" on the Applicant Documents tab no longer removes the row (or its
-- underlying Storage file) immediately — it just stamps deleted_at, moving
-- it into a "Deleted Jotforms" list with a Restore button for 30 days.
-- Nothing purges automatically after 30 days (no cron infra in this app
-- yet) — the UI just stops listing anything older than that in the Deleted
-- view. A real purge (row + Storage file) would need a periodic job later
-- if that's ever wanted.
--
-- Run once in the Supabase SQL Editor, after 0054.
-- =====================================================================

alter table hr_jotform_submissions add column if not exists deleted_at timestamptz;
create index if not exists idx_hr_jotform_submissions_deleted on hr_jotform_submissions(company_id, deleted_at);
