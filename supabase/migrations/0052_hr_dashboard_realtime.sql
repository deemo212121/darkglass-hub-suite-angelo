-- =====================================================================
-- 0052 — Enable realtime replication for the HR & Recruitment Dashboard
--
-- Mirrors 0037_enable_realtime.sql's pattern (the `messages`/`notifications`
-- live-chat setup) for the tables the HR dashboard now subscribes to, so
-- HR staff see changes live — new/updated candidates, warning/mistake
-- reviews, Employee Warning Form status changes, and new activity log
-- entries — without needing to refresh the page. Without this,
-- postgres_changes subscriptions silently never fire.
--
-- Run once in the Supabase SQL Editor, after 0051.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table hr_candidates;
exception when duplicate_object then
  raise notice 'hr_candidates already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table employee_conduct_notes;
exception when duplicate_object then
  raise notice 'employee_conduct_notes already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table hr_signable_documents;
exception when duplicate_object then
  raise notice 'hr_signable_documents already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table hr_activity_log;
exception when duplicate_object then
  raise notice 'hr_activity_log already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table pto_requests;
exception when duplicate_object then
  raise notice 'pto_requests already in supabase_realtime publication';
end $$;
