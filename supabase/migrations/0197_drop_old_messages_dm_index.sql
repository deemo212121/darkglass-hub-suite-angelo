-- Run this file ALONE in the SQL Editor, and only AFTER confirming 0195
-- finished successfully:
--   select indexname from pg_indexes where tablename = 'messages';
-- idx_messages_company_dm_created_active must be listed before you run
-- this — if it isn't, 0195's CONCURRENTLY build failed or was interrupted;
-- re-run 0195 first.
--
-- Drops the now-redundant original from 0001_init.sql — same reasoning as
-- 0196, for the DM-thread side.
drop index concurrently if exists public.idx_messages_dm;
