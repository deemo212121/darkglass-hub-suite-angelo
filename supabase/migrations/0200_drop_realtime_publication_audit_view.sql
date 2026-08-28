-- Diagnostic-only view from migration 0198, no longer needed now that the
-- realtime publication audit (0198) and fix (0199) are both done and
-- verified. This DOES drop something — but only the view itself, which
-- contained no data of its own, just a live read of pg_publication_tables.
drop view if exists public.realtime_publication_audit;
