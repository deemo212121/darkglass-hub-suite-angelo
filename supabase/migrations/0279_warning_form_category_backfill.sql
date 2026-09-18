-- =====================================================================
-- 0279 — Backfill warningCategory on pre-existing Warning Forms
--
-- The EOD/EOM Hiring Report's "Time Card Warning" / "Employee
-- Error/Manipulation" counters (hrCandidates.ts) only count
-- hr_signable_documents(warning_form) rows whose
-- form_data->>'warningCategory' is set. That field didn't exist before
-- this feature shipped, so every warning form sent earlier has no
-- category and silently counts toward neither column. Per the user's
-- own call, backfill all of them as "time_card_warning" so every past
-- warning is still counted somewhere instead of disappearing from the
-- report.
--
-- Idempotent — only touches rows that don't already have a category set,
-- so re-running (or running after new warnings already have one) is safe.
--
-- Run once in the Supabase SQL Editor, after 0278.
-- =====================================================================

update hr_signable_documents
set form_data = form_data || jsonb_build_object('warningCategory', 'time_card_warning')
where document_type = 'warning_form'
  and coalesce(form_data->>'warningCategory', '') = '';
