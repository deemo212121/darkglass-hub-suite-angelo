-- =====================================================================
-- 0190 — Auto-stamp company_id on technician_location_pings (same shared
-- trigger every tenant table uses).
--
-- Found via live testing: useAuth()'s `companyId` field is the legacy
-- human-readable company code (e.g. "COMP001"), not the real
-- companies.id UUID this table's FK needs — so the client was never
-- going to be able to supply a correct company_id directly. Every other
-- tenant table in this app solves this the same way: the client omits
-- company_id from its insert payload entirely and this trigger fills it
-- in from the caller's own JWT before the row is even checked against
-- the table's RLS policies (same order hr_signable_documents_stamp()
-- and its hr_signable_documents_insert policy already rely on).
--
-- Run once in the Supabase SQL Editor, after 0189.
-- =====================================================================

drop trigger if exists trg_technician_location_pings_company on technician_location_pings;
create trigger trg_technician_location_pings_company
  before insert on technician_location_pings
  for each row execute function set_company_id();
