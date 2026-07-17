-- =====================================================================
-- 0065 — Track NSA's own part ID on pulled parts
--
-- Parts pulled from NSA (parts.part_dist = 'NSA') had no stable link back
-- to the NSA part record they came from, so a re-sync had no way to tell
-- "already pulled" from "new" — every run would just re-insert every part
-- again. Adds nsa_part_id (NSA's own "ID" field, e.g. "64107") so the
-- scheduled hourly sync (src/lib/server/nsaPartsSync.ts) can dedupe.
-- =====================================================================

alter table parts add column if not exists nsa_part_id text;

create index if not exists idx_parts_nsa_part_id
  on parts(ticket_id, nsa_part_id)
  where nsa_part_id is not null;
