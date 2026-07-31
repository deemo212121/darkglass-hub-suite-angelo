-- =====================================================================
-- 0096 — Live Chat: inbox upgrades
--
-- - concern/appliance: promoted from being parsed out of the opening
--   message's text (fragile, and unsearchable) into real columns, set
--   directly by the widget's structured intake dropdowns. The opening
--   chat bubble still shows the human-readable "Concern: X / Appliance: Y"
--   text — these columns are for search/filter/the Thread Details panel.
-- - visitor_last_seen_at: refreshed on every GET poll from the widget (see
--   liveChatBridge.ts) — this is the "is the visitor's tab actually open
--   right now" signal the inbox uses for an online/offline dot.
-- - live_chat_inbox_previews(): one row per session with an unread count
--   (visitor messages with read_at still null) and the last message's
--   body/sender/timestamp, for the conversation list's preview text and
--   unread badge. Deliberately NOT security definer — it runs with the
--   caller's own privileges, so live_chat_sessions/live_chat_messages'
--   existing RLS (0093/0094) already scopes which rows it can see, with
--   no visibility logic duplicated here.
--
-- Run once in the Supabase SQL Editor, after 0095.
-- =====================================================================

alter table live_chat_sessions add column if not exists concern text;
alter table live_chat_sessions add column if not exists appliance text;
alter table live_chat_sessions add column if not exists visitor_last_seen_at timestamptz;

create or replace function live_chat_inbox_previews()
returns table (
  session_id uuid,
  unread_count bigint,
  last_message_body text,
  last_message_sender text,
  last_message_at timestamptz
)
language sql stable as $$
  select
    s.id as session_id,
    (
      select count(*) from live_chat_messages m
      where m.session_id = s.id and m.sender = 'visitor' and m.read_at is null
    ) as unread_count,
    lm.body,
    lm.sender,
    lm.created_at
  from live_chat_sessions s
  left join lateral (
    select body, sender, created_at from live_chat_messages m
    where m.session_id = s.id
    order by created_at desc
    limit 1
  ) lm on true;
$$;
