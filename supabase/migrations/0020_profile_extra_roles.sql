-- =====================================================================
-- 0020 — Profile multi-role support
--
-- The Add New User form now lets an admin tick multiple roles for a single
-- user (e.g. "Triage User" + "Parts"). The primary `role` column stays the
-- one canonical role used by RLS and existing access checks; the extra
-- roles live in `extra_roles` as a text[] alongside it. UI access checks
-- can OR-merge primary + extra to grant the union of permissions.
--
-- Triage User / Triage Manager are new role codes added in this round.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table profiles
  add column if not exists extra_roles text[] not null default '{}';

-- Optional index in case any future query filters on contains() of a role.
create index if not exists idx_profiles_extra_roles_gin
  on profiles using gin (extra_roles);
