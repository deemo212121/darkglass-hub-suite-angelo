-- Run this file ALONE in the SQL Editor — do not paste it together with any
-- other statement. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block, and Supabase's SQL Editor sends multiple
-- semicolon-separated statements as one request, which Postgres wraps in an
-- implicit transaction. One statement per "Run" avoids that.
--
-- Replaces idx_messages_channel (channel_id, created_at) — every real query
-- against messages by channel_id also filters deleted_at is null (see
-- getChannelMessages/AnnouncementBanner's peek in messaging.ts /
-- AnnouncementBanner.tsx), and RLS (messages_select) always adds
-- company_id = auth_company_id() on top. Partial + company_id-leading means
-- Postgres can satisfy both predicates from one smaller index instead of an
-- index scan plus a per-row recheck, and the smaller index is more likely to
-- stay resident in shared_buffers under memory pressure.
create index concurrently if not exists idx_messages_company_channel_created_active
  on public.messages (company_id, channel_id, created_at)
  where deleted_at is null;
