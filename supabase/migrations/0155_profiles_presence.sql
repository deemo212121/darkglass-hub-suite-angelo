-- =====================================================================
-- 0155 — Online/Idle/Offline presence for Master List.
--
-- Two separate timestamps, not one — they answer different questions:
--   presence_seen_at   — a heartbeat, written every ~60s while the app is
--                         open in a tab, REGARDLESS of activity. If this
--                         stops updating, the tab closed / they logged
--                         out / lost connection -> Offline.
--   presence_active_at — written only on real user interaction (mouse,
--                         keyboard, scroll, touch), throttled client-side.
--                         If the tab is open (heartbeat still fresh) but
--                         this hasn't moved in 10+ minutes -> Idle.
--
-- Client-side status math (see ReportHRDaily.tsx):
--   presence_seen_at older than ~3 min (or null)   -> Offline
--   presence_active_at older than 10 min            -> Idle
--   otherwise                                        -> Online
--
-- No new RLS policy needed — the existing profiles UPDATE policy already
-- lets a signed-in user update their own row (My Profile's self-service
-- edits already rely on this), and RLS is row-level, not column-level.
--
-- Run once in the Supabase SQL Editor, after 0154.
-- =====================================================================

alter table profiles add column if not exists presence_seen_at timestamptz;
alter table profiles add column if not exists presence_active_at timestamptz;
