-- Run this file ALONE in the SQL Editor — see 0194's header comment for why
-- (CREATE INDEX CONCURRENTLY cannot run inside a transaction block).
--
-- Replaces idx_messages_dm (dm_thread_id, created_at) — same reasoning as
-- 0194, but for the DM-thread-scoped message reads (getDmMessages, the DM
-- inbox preview loader, etc. in messaging.ts), all of which filter
-- deleted_at is null.
create index concurrently if not exists idx_messages_company_dm_created_active
  on public.messages (company_id, dm_thread_id, created_at)
  where deleted_at is null;
