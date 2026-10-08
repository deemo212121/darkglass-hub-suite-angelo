-- =====================================================================
-- 0365 — Messages: "Mark as unread".
--
-- A flag on the person's own read pointer for a channel / DM. While it's
-- on, the conversation shows as unread (at least 1) in the header Messages
-- drop-down, the floating messenger and the Team Messenger, even though
-- last_read_at hasn't moved. Opening the conversation (markThreadRead)
-- turns it back off.
--
-- last_read_at is deliberately NOT rewound: the other person's "Seen"
-- receipt reads it (readReceipts.ts), and marking a chat unread for
-- yourself shouldn't un-see their message.
--
-- Run once in the Supabase SQL Editor, after 0364.
-- =====================================================================

alter table message_reads add column if not exists marked_unread boolean not null default false;
