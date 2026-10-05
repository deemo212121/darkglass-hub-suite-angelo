-- =====================================================================
-- 0348 — Brand chosen for a Marcone / Encompass part.
--
-- One part number can exist under several brands at the distributor
-- (Marcone "make", Encompass "mfgCode"), each with its own stock. The
-- ticket's Part Transaction now has a Brand dropdown under Part Dist.
-- (listing each brand with its stock); the choice is saved here as
-- "<Distributor>|<code>" — e.g. "Marcone|GEH" or "Encompass|WHI" — and
-- Submit POs / Place Order sends that brand. Empty = the old behaviour
-- (the distributor's first match).
--
-- Run once in the Supabase SQL Editor, after 0347.
-- =====================================================================

alter table parts add column if not exists dist_brand text;
