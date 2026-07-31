-- =====================================================================
-- 0099_role_hierarchy_split.sql
--
-- Splits the single global SUPERADMIN role into two tiers:
--   - SUPERSUPERADMIN: the platform-level role (renamed from today's
--     SUPERADMIN) — creates/edits/deletes companies, bootstraps a new
--     company's first admin, via the /superadmin console. Unchanged
--     powers, new name.
--   - SUPERADMIN: a NEW, per-company-scoped role. Same permission
--     surface as ADMIN everywhere else in the app (it reuses the exact
--     same 'SUPERADMIN' string that every existing company-internal
--     allow-list already lists alongside 'ADMIN'), plus one new power:
--     it can update its own company's record (companies_update below) —
--     the one thing previously locked to the platform role alone.
--
-- Order matters: the CHECK constraint must allow 'SUPERSUPERADMIN'
-- BEFORE the data rename runs, or the UPDATE fails against the old
-- constraint.
-- =====================================================================

-- ---------- 1. Widen profiles_role_check ----------
-- Same full list as 0087_role_codes_expand2.sql (the current
-- authoritative version — confirmed no migration after it touches this
-- constraint), plus 'SUPERSUPERADMIN'. 'SUPERADMIN' stays — it's the
-- new company-scoped role now.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in (
    -- Canonical base codes
    'SUPERSUPERADMIN','SUPERADMIN','ADMIN','MANAGER','CSR','TECHNICIAN','TECHNICIAN_MANAGER',
    'DISPATCHER','CLAIMS','HR','IT','PARTS','FINANCE',
    -- Extended codes
    'CSR_AGENT','CSR_TEAM_LEADER','CSR_MANAGER',
    'BRANCH_MANAGER','SENIOR_BRANCH_MANAGER',
    'CLAIMS_MANAGER','PARTS_MANAGER',
    'BIZOPS_MANAGER','BIZOPS_SENIOR_MANAGER',
    'TRIAGE_USER','TRIAGE_MANAGER',
    'TECHNICAL_DIRECTOR',
    'TECHNICAL_ASSISTANT_DIRECTOR','CLAIMS_TEAM_LEADER',
    -- Legacy Title Case labels (back-compat)
    'CSR Agent','CSR Team Leader','CSR Manager',
    'Branch Manager','Senior Branch Manager',
    'Claims Manager','Parts Manager',
    'BizOps Manager','BizOps Senior Manager'
  ));

-- ---------- 2. Rename existing platform-level accounts ----------
update profiles set role = 'SUPERSUPERADMIN' where role = 'SUPERADMIN';
update profiles set extra_roles = array_replace(extra_roles, 'SUPERADMIN', 'SUPERSUPERADMIN')
  where 'SUPERADMIN' = any(extra_roles);

-- SUPERSUPERADMIN is a platform-wide role, not tied to any one company —
-- unlike the new company-scoped SUPERADMIN, it should never "belong to" or
-- show up under a company. Every RLS policy it needs to pass already grants
-- access via is_superadmin() independent of company_id (see the
-- login_events_select fix in step 6 below, which previously assumed this
-- role always had a real company_id), so this is safe to null out.
update profiles set company_id = null where role = 'SUPERSUPERADMIN';

-- ---------- 3. Repoint is_superadmin() at the renamed platform role ----------
-- Name is unchanged deliberately: this function is referenced by name in
-- ~130 RLS policies across ~28 other migration files (companies_*, every
-- tenant-table policy, set_company_id(), etc.). Redefining only the body
-- here means none of those files need to change — they all automatically
-- keep meaning "the platform-level role" once this body changes. The name
-- now predates the rename; it still means "the platform superadmin," just
-- under its new role string.
create or replace function is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and role = 'SUPERSUPERADMIN'
  );
$$;

-- ---------- 4. New helper for the company-scoped SUPERADMIN ----------
-- Mirrors is_admin()'s modern role-or-extra_roles pattern (0089_login_events.sql).
create or replace function is_company_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (role = 'SUPERADMIN' or 'SUPERADMIN' = any(extra_roles))
  );
$$;

-- ---------- 5. companies_update: let the company-scoped role edit its own row ----------
-- companies_insert/companies_delete stay is_superadmin()-only — company
-- creation/deletion remains platform-exclusive.
drop policy if exists companies_update on companies;
create policy companies_update on companies
  for update
  using (is_superadmin() or (is_company_superadmin() and id = auth_company_id()))
  with check (is_superadmin() or (is_company_superadmin() and id = auth_company_id()));

-- ---------- 6. login_events_select: extend to the company-scoped role, and ----------
--             stop assuming the platform role has a real company_id
-- Previously `company_id = auth_company_id() and (is_admin() or
-- is_superadmin())` — the AND meant a platform SUPERADMIN could only ever
-- see login_events for whatever single company their OWN profile happened
-- to belong to (this "worked" only by accident, since every SUPERADMIN
-- profile used to have a real company_id). Now that SUPERSUPERADMIN's
-- company_id is null (step 2 above), that AND would show them NOTHING —
-- so is_superadmin() needs its own unconditional OR clause, matching how
-- every other table's RLS already treats the platform role.
drop policy if exists login_events_select on login_events;
create policy login_events_select on login_events
  for select using (
    (company_id = auth_company_id() and (is_admin() or is_company_superadmin()))
    or is_superadmin()
  );

-- ---------- 7. set_company_id(): let a platform admin create a company-less row ----------
-- Previous body: "if is_superadmin() and new.company_id is not null then
-- keep it; else force it to the caller's own company_id" — which had no way
-- to actually create a company-less profile (a null company_id from the
-- caller just fell through to the else branch and got overwritten). Now
-- that a SUPERSUPERADMIN can create ANOTHER SUPERSUPERADMIN with no
-- company at all (via /superadmin's Add Admin form), this needs to accept
-- whatever company_id the platform role explicitly supplies, including
-- null — non-superadmin callers are unaffected, they're still always
-- forced to their own company_id.
create or replace function set_company_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_superadmin() then
    return new;
  end if;
  new.company_id := auth_company_id();
  return new;
end;
$$;

-- Run once in the Supabase SQL Editor.
-- =====================================================================
