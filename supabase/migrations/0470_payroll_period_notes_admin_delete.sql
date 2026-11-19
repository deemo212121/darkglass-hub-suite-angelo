-- =====================================================================
-- 0470 — payroll_period_notes: only Admin / SuperAdmin delete notes.
-- Notes are the required "why" behind every Tech Activity Report change,
-- so the author can no longer delete their own (0465 allowed that). Notes
-- are never edited (no update policy) — a correction is a new note.
--
-- Run once in the Supabase SQL Editor, after 0465.
-- =====================================================================

drop policy if exists payroll_period_notes_delete on payroll_period_notes;
create policy payroll_period_notes_delete on payroll_period_notes
  for delete using (
    (company_id = auth_company_id() and (is_admin() or is_company_superadmin()))
    or is_superadmin()
  );

-- No update policy exists (RLS denies every update) — kept that way.
drop policy if exists payroll_period_notes_update on payroll_period_notes;
