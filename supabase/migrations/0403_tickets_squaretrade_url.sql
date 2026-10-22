-- =====================================================================
-- 0403 — tickets.squaretrade_url: the ticket's Square Trade appointment link.
--
-- Square Trade sends each claim its own "confirm appointment" link (with a
-- one-claim token). The ticket page's Account name opens it; the pencil
-- next to it saves a pasted one, and links found in the ServicePower notes
-- are saved automatically. Until now that link only lived in the browser
-- that saved it — kept here so everyone on the team gets it.
-- Adds a column only — no existing data is changed.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table tickets add column if not exists squaretrade_url text;
