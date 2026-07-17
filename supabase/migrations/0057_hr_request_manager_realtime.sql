-- =====================================================================
-- 0057 — Enable realtime for timecard_corrections and employee_requests
--
-- The new "Employee Request Manager" tab on the HR & Recruitment Dashboard
-- (ReportHRDaily.tsx) subscribes to these two tables (alongside the
-- already-realtime pto_requests) so PTO/Time Correction/Attendance
-- Dispute/Payroll Inquiry requests update live without a manual refresh —
-- same postgres_changes pattern as 0037/0052/0056.
--
-- Run once in the Supabase SQL Editor, after 0056.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table timecard_corrections;
exception when duplicate_object then
  raise notice 'timecard_corrections already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table employee_requests;
exception when duplicate_object then
  raise notice 'employee_requests already in supabase_realtime publication';
end $$;
