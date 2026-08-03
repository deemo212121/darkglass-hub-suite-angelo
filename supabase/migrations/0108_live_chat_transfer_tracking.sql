-- =====================================================================
-- 0108 — Live Chat: track who transferred a chat + a dedicated "Transferred" tab
--
-- transferred_from / transferred_from_name record whoever most recently
-- handed this chat to someone else via Transfer — set by the new
-- liveChatStaffBridge.ts server action (service-role key, bypasses RLS;
-- see that file's header comment for why Transfer moved server-side
-- instead of writing assigned_to directly from the client under RLS).
-- Not cleared on a later transfer or reassignment — it's a permanent
-- "this chat has been transferred at least once, most recently by X"
-- marker, same spirit as escalated (migration 0093-adjacent) never
-- resetting itself either.
--
-- Run once in the Supabase SQL Editor, after 0107.
-- =====================================================================

alter table live_chat_sessions add column if not exists transferred_from uuid references profiles(id) on delete set null;
alter table live_chat_sessions add column if not exists transferred_from_name text;
