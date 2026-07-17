-- =====================================================================
-- 0056 — Enable realtime for timecard_entries
--
-- The new Attendance KPI tile on the HR & Recruitment Dashboard
-- (ReportHRDaily.tsx) subscribes to timecard_entries so today's
-- present/absent breakdown updates live as people clock in/out, same
-- postgres_changes pattern as 0037/0052.
--
-- Run once in the Supabase SQL Editor, after 0055.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table timecard_entries;
exception when duplicate_object then
  raise notice 'timecard_entries already in supabase_realtime publication';
end $$;
