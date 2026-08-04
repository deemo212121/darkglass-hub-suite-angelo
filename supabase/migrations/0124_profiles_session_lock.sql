-- =====================================================================
-- 0124 — One active session per account
--
-- current_session_id is minted fresh on every real interactive login (see
-- src/lib/server/supabaseTokenBridge.ts's recordLogin branch) and compared
-- against what each device has locally stored (src/lib/auth.tsx) on every
-- token refresh. A mismatch means a later login elsewhere has superseded
-- this device, which signs itself out and shows a banner
-- (SessionKickedOutBanner.tsx).
--
-- Added to the supabase_realtime publication so the superseded device finds
-- out immediately via src/lib/supabase/realtime.ts's subscribeTableChanges
-- (already the established pattern for messages/notifications/HR-candidate
-- live updates — see 0037/0052) instead of waiting for its next 45-min
-- token refresh.
--
-- Run once in the Supabase SQL Editor, after 0123.
-- =====================================================================

alter table profiles add column if not exists current_session_id uuid;

do $$
begin
  alter publication supabase_realtime add table profiles;
exception when duplicate_object then
  raise notice 'profiles already in supabase_realtime publication';
end $$;
