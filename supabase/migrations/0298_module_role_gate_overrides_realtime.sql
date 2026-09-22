-- =====================================================================
-- 0298 — Enable realtime replication for module_role_gate_overrides
--
-- Accessibility Management edits (grant/revoke a role's access to a page)
-- write to this table (migration 0151), and every signed-in client keeps
-- an in-memory cache of it (src/lib/moduleAccess.ts) that decides what
-- that person can actually open. Without this table in the
-- supabase_realtime publication, an edit only ever reached the tab that
-- made it — every OTHER already-open session (a different device, a
-- different tab, someone still signed in from earlier) kept using its
-- stale cache until it happened to log in again, so a revoked page stayed
-- reachable for that person indefinitely. src/lib/auth.tsx now subscribes
-- to this table (scoped to the signed-in user's own company_id) and
-- re-hydrates the cache the instant a row changes, and
-- m.$module.$submodule.tsx's route guard reads it through a reactive hook
-- (useModuleRoleGate) so a page someone is actively sitting on re-checks
-- itself immediately too, not just the cache underneath it.
--
-- Run once in the Supabase SQL Editor, after 0151.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table module_role_gate_overrides;
exception when duplicate_object then
  raise notice 'module_role_gate_overrides already in supabase_realtime publication';
end $$;
