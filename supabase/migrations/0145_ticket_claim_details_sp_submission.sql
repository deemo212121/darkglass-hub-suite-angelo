-- =====================================================================
-- 0145 — Ticket Claim Details: ServicePower submission result
--
-- Backs the new "Submit to ServicePower" action on the Pre-Claim modal
-- (PreClaimModal.tsx), which POSTs the already-captured claim fields to
-- SP's Claim Submission API (services/claim/v1/submission) instead of the
-- Claims team re-keying them into SP's own web portal.
--
-- sp_claim_batch_number / sp_claim_sequence_number are the identifiers SP
-- assigns on first submission — every RESUBMISSION of this same claim
-- (e.g. after correcting a validation error) must pass these back as
-- existingClaimBatchNumber/existingClaimSequenceNumber, per SP's own
-- integration guide, or SP creates a brand new duplicate claim instead of
-- updating this one. Null until the first successful submission.
--
-- sp_claim_status_code/description are SP's own claim status ("I" =
-- Incomplete is common even on a response code of OK — see the guide's
-- ERRORS section) — shown in the UI so Claims doesn't have to log into SP
-- separately just to see whether a claim needs further correction.
--
-- sp_last_response holds the full raw JSON response (including any
-- errors/messages arrays) for troubleshooting a rejected submission,
-- without needing server logs.
--
-- Run once in the Supabase SQL Editor, after 0144.
-- =====================================================================

alter table ticket_claim_details add column if not exists sp_claim_batch_number text;
alter table ticket_claim_details add column if not exists sp_claim_sequence_number text;
alter table ticket_claim_details add column if not exists sp_claim_status_code text;
alter table ticket_claim_details add column if not exists sp_claim_status_description text;
alter table ticket_claim_details add column if not exists sp_submitted_at timestamptz;
alter table ticket_claim_details add column if not exists sp_last_response jsonb;
