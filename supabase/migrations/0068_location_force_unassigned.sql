-- =====================================================================
-- 0068 — Branch-level "force unassigned" override for default technician
--
-- A branch's Rep Tech (location_mgmt_locations.rep_tech) being blank has
-- always meant "no override" -> new tickets fall back to the company-wide
-- default technician (0067). There was no way to say "this branch should
-- genuinely stay unassigned, even though the company has a default set."
--
-- force_unassigned adds that third state. Ticket creation logic (see
-- NewTicketPage.tsx) now reads: if force_unassigned, technician = "";
-- else if rep_tech is set, use it; else fall back to the company default.
--
-- Run once in the Supabase SQL Editor, after 0067.
-- =====================================================================

alter table location_mgmt_locations
  add column force_unassigned boolean not null default false;
