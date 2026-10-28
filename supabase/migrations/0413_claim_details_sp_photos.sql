-- =====================================================================
-- 0413 — Pre-Claim: pictures with Square Trade / SPPN claims.
--
-- Square Trade claims need the ticket's pictures; SPPN claims need them
-- when the unit is unrepairable or its serial number doesn't match. The
-- Pre-Claim (PreClaimModal.tsx) holds Submit to ServicePower until the
-- ticket has them, and sends them to the claim with ServicePower's Add
-- Document to Claim.
--   * sp_unrepairable / sp_serial_mismatch — the two SPPN boxes on the
--     Pre-Claim;
--   * sp_documents — the pictures already sent to ServicePower for this
--     claim ([{path, name, documentId, sentAt}]), so none is sent twice.
--
-- Columns only — no data changes, no policy changes (ticket_claim_details'
-- existing row policies cover them). Safe to run again.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table ticket_claim_details
  add column if not exists sp_unrepairable boolean not null default false,
  add column if not exists sp_serial_mismatch boolean not null default false,
  add column if not exists sp_documents jsonb not null default '[]'::jsonb;
