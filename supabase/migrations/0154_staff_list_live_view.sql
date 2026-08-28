-- =====================================================================
-- 0154 — Staff List's per-branch roster becomes a live view of the same
-- profiles Master List already manages, instead of its own frozen copy
-- imported from Excel.
--
-- staff_list_roster (0153) never actually held data (every earlier
-- import attempt rolled back at 0 rows) and would only ever drift out of
-- sync with Master List's real Name/Start Date/branch — so it's dropped
-- outright rather than migrated. staff_list_current_staff (branch-manager
-- summary) and staff_list_tier_level (pay-rate table) stay: those aren't
-- per-person records, they don't exist anywhere else in the app.
--
-- The Excel roster carried 4 fields that genuinely don't exist on
-- profiles yet — personal_email, tier_level (technician skill tier, not
-- an org role), work_phone, and a free-text staff_note. Adding them
-- directly to profiles is what makes Staff List's branch tabs a live
-- view: editing them here writes straight to the same row Master List
-- reads, so the two can never disagree.
--
-- Run once in the Supabase SQL Editor, after 0153. Follow with
-- scripts/staff_list_backfill.sql to populate the 4 new columns for
-- whichever of the 182 active Excel people already exist as real
-- profiles (matched by name) — see that script's header for how
-- unmatched names are reported instead of silently dropped.
-- =====================================================================

drop table if exists staff_list_roster;

alter table profiles add column if not exists personal_email text;
alter table profiles add column if not exists work_phone text;
alter table profiles add column if not exists tier_level text;
alter table profiles add column if not exists staff_note text;
