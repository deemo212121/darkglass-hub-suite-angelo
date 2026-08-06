-- =====================================================================
-- 0134 — Parts: Distributor # and Job Code
--
-- Two fields on the Pre-Claim modal's Parts Used table (NeedClaimList.tsx)
-- that don't have a matching column yet: part_dist already names the
-- distributor (e.g. "Encompass"), but nothing tracks that distributor's
-- own reference/account number for the order; job_code tags an individual
-- part line with a claim job code, distinct from the ticket-level job code
-- (ticket_claim_details.job_code, migration 0135).
-- =====================================================================

alter table parts add column if not exists distributor_no text;
alter table parts add column if not exists job_code text;
