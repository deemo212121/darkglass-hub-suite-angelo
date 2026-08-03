-- =====================================================================
-- 0094 — Live Chat: photo attachments, typing indicators, read receipts
--
-- Photos: a visitor can attach one image per message (appliance photo,
-- model sticker, error code, damaged part, water leak, ...) — uploaded via
-- the public bridge (src/lib/server/liveChatBridge.ts) straight to Firebase
-- Storage, same mechanism as the file/signature answers on Custom Forms.
--
-- Typing indicators: visitor_typing_at/staff_typing_at on the session are
-- just "last typed at" timestamps, refreshed (throttled client-side) while
-- someone has text in the box. The other side treats a timestamp within
-- the last few seconds as "still typing" — no explicit clear/stop event
-- needed, it just times out on its own between polls.
--
-- Read receipts: delivered_at is set the first time the OTHER party's
-- client actually fetches a message; read_at is set specifically when the
-- recipient has that exact conversation open (not just a background list
-- refresh) — see getLiveChatMessages/listLiveChatSessions in
-- src/lib/supabase/liveChat.ts and the GET handler in liveChatBridge.ts.
--
-- Run once in the Supabase SQL Editor, after 0093.
-- =====================================================================

alter table live_chat_messages add column if not exists attachment_url text;
alter table live_chat_messages add column if not exists attachment_name text;
alter table live_chat_messages add column if not exists attachment_mime_type text;
alter table live_chat_messages add column if not exists delivered_at timestamptz;
alter table live_chat_messages add column if not exists read_at timestamptz;

alter table live_chat_sessions add column if not exists visitor_typing_at timestamptz;
alter table live_chat_sessions add column if not exists staff_typing_at timestamptz;

-- Staff need to mark a visitor's messages as read/delivered — there was no
-- update policy on live_chat_messages at all before this (only select +
-- insert). Same "inherit visibility from the session" pattern as the
-- select policy in migration 0093.
drop policy if exists live_chat_messages_update on live_chat_messages;
create policy live_chat_messages_update on live_chat_messages
  for update using (
    exists (select 1 from live_chat_sessions s where s.id = live_chat_messages.session_id)
  )
  with check (
    exists (select 1 from live_chat_sessions s where s.id = live_chat_messages.session_id)
  );
