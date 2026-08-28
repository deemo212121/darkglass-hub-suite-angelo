-- One-time diagnostic: PostgREST only exposes the "public" schema, so
-- there's no way to read pg_publication_tables (a system catalog) over the
-- REST API directly. This view re-exposes just the supabase_realtime
-- publication's table membership, read-only, restricted to service_role.
-- Safe to drop once the audit is done — see the DROP statement at bottom.

create or replace view public.realtime_publication_audit as
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime';

revoke all on public.realtime_publication_audit from public, anon, authenticated;
grant select on public.realtime_publication_audit to service_role;

-- To remove this diagnostic view once you're done with it:
-- drop view public.realtime_publication_audit;
