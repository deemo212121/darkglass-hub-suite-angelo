-- =====================================================================
-- 0095 — Live Chat: visitor phone number
--
-- Required in the widget's pre-chat form (unlike name/branch, which stay
-- optional) so staff always have a callback number, even if the chat
-- itself goes stale. Nullable at the DB level regardless, same as the
-- other visitor_* columns — the requirement is enforced by the widget and
-- the public bridge, not a NOT NULL constraint, since existing sessions
-- created before this column existed have nothing to backfill it with.
--
-- Run once in the Supabase SQL Editor, after 0094.
-- =====================================================================

alter table live_chat_sessions add column if not exists visitor_phone text;
