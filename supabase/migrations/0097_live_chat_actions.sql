-- =====================================================================
-- 0097 — Live Chat: conversation actions, quick-action requests, internal notes
--
-- - escalated: a session-level flag toggled from the "Escalate" header
--   button — a visual flag in the queue, not a workflow of its own.
-- - live_chat_messages.kind: distinguishes a normal chat bubble from a
--   structured "quick action" request (callback/appointment) or a
--   staff-only internal note. request_data carries the structured
--   payload (e.g. { preference: 'now' } or { day: 'tomorrow', date: '...' })
--   so the UI can render a proper badge instead of parsing free text.
-- - Internal notes are sender='staff' rows with kind='internal_note' —
--   they're never returned to the visitor (see liveChatBridge.ts's GET
--   handler, which explicitly excludes kind=internal_note) even though
--   RLS doesn't need to enforce this (the visitor never holds a session
--   at all, per migration 0091's header comment).
--
-- Run once in the Supabase SQL Editor, after 0096.
-- =====================================================================

alter table live_chat_sessions add column if not exists escalated boolean not null default false;

alter table live_chat_messages add column if not exists kind text not null default 'chat';
alter table live_chat_messages add column if not exists request_data jsonb;

alter table live_chat_messages drop constraint if exists live_chat_messages_kind_check;
alter table live_chat_messages add constraint live_chat_messages_kind_check
  check (kind in ('chat', 'callback_request', 'appointment_request', 'internal_note'));
