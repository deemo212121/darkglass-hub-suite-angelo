-- =====================================================================
-- 0025_ticket_source_edited.sql
--
-- Adds a "source_edited_by_user" flag on tickets so admins can correct
-- a mis-classified Work Order Source (e.g. an Electrolux ticket that
-- SP filed under Assurant's MfgId) without the next SP auto-sync
-- clobbering the correction.
--
-- The sync writer will read this flag and skip the `ticket_source`,
-- `account`, and `claim_company` columns for any row where it's true.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table tickets
  add column if not exists source_edited_by_user boolean not null default false;
