-- =====================================================================
-- 0277 — Safety net for ebay_branch_daily_notes.listings_status.
--
-- 0275 was edited in place to add this column while being iterated on,
-- but "create table if not exists" is a no-op against a table that
-- already exists — so if 0275 was run before that edit landed, the
-- live table never got the column, and every per-day Listings status
-- save on the Parts Daily Report eBAY Summary tab fails silently with
-- a generic "Failed to save listings status" (the real Postgres error,
-- e.g. "column listings_status does not exist", was being swallowed by
-- the UI before this was fixed too).
--
-- Safe to run regardless of whether the column already exists.
-- Run once in the Supabase SQL Editor, after 0276.
-- =====================================================================

alter table ebay_branch_daily_notes
  add column if not exists listings_status text check (listings_status in ('Paused', 'All Listed'));
