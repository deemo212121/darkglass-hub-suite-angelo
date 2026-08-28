-- Realtime publication cleanup + fix, based on the audit in migration 0198
-- (supabase/migrations/0198_realtime_publication_audit_view.sql).
--
-- IMPORTANT — what this does NOT do: "ALTER PUBLICATION ... DROP TABLE" /
-- "ADD TABLE" only changes which tables Postgres's realtime change-feed
-- (realtime.list_changes, the query costing 68.8% of observed DB time)
-- watches for live-broadcast purposes. It does not drop, truncate, or
-- alter the table itself or any of its data in any way — every row in
-- every table below stays fully intact and fully queryable exactly as
-- before, through the normal REST API, the Table Editor, everywhere.

-- 1) Remove 3 tables that are in the publication but have zero app-side
--    realtime subscribers (confirmed by searching the whole codebase for
--    every .channel()/subscribeTableChanges() call site) — every write to
--    these was being needlessly scanned by list_changes for no benefit.
alter publication supabase_realtime drop table public.hr_custom_forms;
alter publication supabase_realtime drop table public.hr_custom_form_submissions;
alter publication supabase_realtime drop table public.hr_onboarding_document_columns;

-- 2) Add 3 tables the app already has live subscriptions for
--    (ReportHRDaily.tsx: subscribeTableChanges("timecard_entries", ...),
--    ("timecard_corrections", ...), ("employee_requests", ...)) but which
--    were never actually added to the publication — per
--    src/lib/supabase/realtime.ts's own header comment, a subscription on
--    an unpublished table "silently never fires". Confirmed via full-file
--    search that there's no polling fallback for these three lists either,
--    so this was a real, currently-broken "HR sees updates live" feature,
--    not just a performance question. This fixes it.
alter publication supabase_realtime add table public.timecard_entries;
alter publication supabase_realtime add table public.timecard_corrections;
alter publication supabase_realtime add table public.employee_requests;
