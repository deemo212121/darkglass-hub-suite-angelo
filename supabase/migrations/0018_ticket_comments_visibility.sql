-- =====================================================================
-- 0018 — Ticket comments visibility flag (Running Notes Internal/External)
-- The ticket detail's "Running Notes" thread lets staff post either:
--   • Internal — visible to AHS staff only
--   • External — also surfaced to ServicePower / claim portals
-- This column drives the toggle. Defaults to internal to keep older rows
-- private until reclassified.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table ticket_comments
  add column if not exists is_internal boolean not null default true;
