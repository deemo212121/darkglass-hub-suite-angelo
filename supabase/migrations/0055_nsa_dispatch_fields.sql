-- =====================================================================
-- 0055 — Persist NSA dispatch fields on tickets
--
-- nsaSync.ts's convertDispatchToTicket() has always computed these values
-- from the NSA API response (status, route, group, deductible, schedule
-- ack, special instructions, coverage, pre-auth, master code) but they
-- were silently dropped — upsertTicketFromServicePowerImpl() only ever
-- wrote the fixed set of columns below to `tickets`, with no handling for
-- any nsa*-prefixed field. The ticket detail page worked around this by
-- re-fetching straight from the NSA API on every page view (see the
-- getNsaDispatch() effect in ticket.$ticketNo.tsx), but that means the raw
-- NSA status/route/etc. never existed anywhere a per-ticket API call
-- isn't made — invisible to the Work Map, Ticket List, and any reporting.
--
-- The NSA case number is NOT duplicated here — it already has a home in
-- tickets.original_ticket_no (see nsaSync.ts's field-mapping comment) and
-- is already persisted correctly; only the fields that were being computed
-- and thrown away are added.
--
-- Run once in the Supabase SQL Editor, after 0054.
-- =====================================================================

alter table tickets add column if not exists nsa_status text;
alter table tickets add column if not exists nsa_route_name text;
alter table tickets add column if not exists nsa_group_name text;
alter table tickets add column if not exists nsa_deductible text;
alter table tickets add column if not exists nsa_schedule_ack text;
alter table tickets add column if not exists nsa_special_instructions text;
alter table tickets add column if not exists nsa_valid_coverage text;
alter table tickets add column if not exists nsa_required_coverage text;
alter table tickets add column if not exists nsa_required_part text;
alter table tickets add column if not exists nsa_pre_auth text;
alter table tickets add column if not exists nsa_master_code text;
alter table tickets add column if not exists nsa_coverage_exclusions text;
