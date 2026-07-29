-- =====================================================================
-- 0092 — "Assist" claim on live chat sessions
--
-- Lets one staff member claim a chat so others in the queue see it's
-- already being handled, instead of two people replying at once. Race-safe
-- by construction: the claim (assistLiveChatSession in src/lib/supabase/liveChat.ts)
-- does `update ... where id = X and assigned_to is null`, so if two staff
-- click "Assist" on the same still-open chat at nearly the same moment,
-- Postgres's row lock during the UPDATE means only the first one actually
-- matches a row — the loser's update affects zero rows and the UI reports
-- it back as "someone else already picked this up."
--
-- assigned_to_name is denormalized (not just joined from profiles) so the
-- queue list can render it without an extra round trip, same convention as
-- sender_name on live_chat_messages.
--
-- Run once in the Supabase SQL Editor, after 0091.
-- =====================================================================

alter table live_chat_sessions add column if not exists assigned_to uuid references profiles(id) on delete set null;
alter table live_chat_sessions add column if not exists assigned_to_name text;
create index if not exists idx_live_chat_sessions_assigned_to on live_chat_sessions(assigned_to);
