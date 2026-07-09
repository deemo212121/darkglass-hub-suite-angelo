-- =====================================================================
-- 0037 — Enable realtime replication for live-subscribed tables
--
-- The app subscribes to postgres_changes on `messages` (live chat/DM
-- updates, and the bell icon's DM-based system-notification feed) and
-- `notifications` (the dedicated bell-icon table added in 0035) via
-- src/lib/supabase/messaging.ts and src/lib/supabase/notifications.ts.
-- Those subscriptions silently never fire unless the table is added to
-- the supabase_realtime publication — without this, "live" updates only
-- ever appeared after a full page reload.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then
  raise notice 'messages already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then
  raise notice 'notifications already in supabase_realtime publication';
end $$;
