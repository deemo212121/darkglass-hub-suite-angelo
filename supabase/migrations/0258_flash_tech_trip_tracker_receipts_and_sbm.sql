-- =====================================================================
-- 0258 — Flash Tech Tracker: drop SBM Confirmed, receipts become a list (up to 5)
--
-- SBM Confirmed (0257) is removed outright per explicit request — not
-- replaced by anything else on this table.
--
-- Receipts: was a single receipt_path (one attachment per trip). Now
-- receipt_paths, a plain array — the Tracker UI caps uploads at 5, but
-- that's enforced client-side only, same as every other soft limit in this
-- app; nothing here hard-caps the array length. Any already-uploaded single
-- receipt is preserved as the first (only) element instead of being lost.
--
-- Run once in the Supabase SQL Editor, after 0257.
-- =====================================================================

alter table flash_tech_trips drop column if exists sbm_confirmed;
alter table flash_tech_trips drop column if exists sbm_confirmed_by;
alter table flash_tech_trips drop column if exists sbm_confirmed_by_name;

alter table flash_tech_trips add column if not exists receipt_paths text[] not null default '{}';

update flash_tech_trips
set receipt_paths = array[receipt_path]
where receipt_path is not null and coalesce(array_length(receipt_paths, 1), 0) = 0;

alter table flash_tech_trips drop column if exists receipt_path;
