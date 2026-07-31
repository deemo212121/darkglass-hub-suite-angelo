-- =====================================================================
-- 0105 — Live Chat: system messages (e.g. "Agent joined the chat")
--
-- kind='system' is a small gray notice shown to BOTH staff and the visitor
-- (unlike kind='internal_note', which is staff-only) — rendered as plain
-- centered text, not a chat bubble or a request badge. See
-- assistLiveChatSession() in src/lib/supabase/liveChat.ts.
--
-- Run once in the Supabase SQL Editor, after 0104.
-- =====================================================================

alter table live_chat_messages drop constraint if exists live_chat_messages_kind_check;
alter table live_chat_messages add constraint live_chat_messages_kind_check
  check (kind in ('chat', 'callback_request', 'appointment_request', 'internal_note', 'system'));
