-- =====================================================================
-- 0208 — Custom roles, created from the UI (Accessibility Management's
-- "Add Role"), no code change/migration needed per role.
--
-- Previously every new role required both a code change (ROLE_LABELS,
-- src/lib/roleLabels.ts) AND a migration expanding profiles_role_check
-- (see 0014/0024/0087/0099/0102/0170_add_parts_order_role.sql — each one
-- redefines the same CHECK constraint to add one more allowed value).
-- custom_roles replaces that: an Admin/SuperAdmin can create a role from
-- the app, and it's immediately usable — including as a user's PRIMARY
-- role — with no deploy.
--
-- profiles.role is `text`, not a Postgres enum, so profiles_role_check was
-- the only thing blocking arbitrary values. A CHECK constraint can't
-- reference another table (no subqueries), so there's no way to keep it
-- while validating against this dynamic table without a trigger. Writes to
-- profiles.role already require Admin/SuperAdmin-tier RLS, and the client
-- is the only thing that will ever offer role choices (built-ins from
-- ROLE_LABELS, or a real custom_roles row) — so this migration just drops
-- the constraint rather than adding trigger complexity. Known, accepted
-- tradeoff: the DB no longer catches a typo'd role written directly via
-- SQL/API; enforcement moves entirely to the client only offering valid
-- options.
--
-- Modeled directly on module_role_gate_overrides (0151) — same
-- auth_company_id() stamping trigger, same RLS shape.
--
-- Run once in the Supabase SQL Editor, after 0207.
-- =====================================================================

create table if not exists custom_roles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  code        text not null,   -- canonical, e.g. WAREHOUSE_LEAD (normalizeRole(label))
  label       text not null,   -- display text, e.g. "Warehouse Lead"
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists idx_custom_roles_company on custom_roles(company_id);

create or replace function custom_roles_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_custom_roles_stamp on custom_roles;
create trigger trg_custom_roles_stamp before insert on custom_roles
  for each row execute function custom_roles_stamp();

alter table custom_roles enable row level security;
alter table custom_roles force row level security;

-- Any company member can read (needed to populate role pickers app-wide).
drop policy if exists custom_roles_select on custom_roles;
create policy custom_roles_select on custom_roles
  for select using (company_id = auth_company_id() or is_superadmin());

-- Only Admin/SuperAdmin (or the platform SuperSuperAdmin) may create,
-- rename, or delete roles.
drop policy if exists custom_roles_insert on custom_roles;
create policy custom_roles_insert on custom_roles
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists custom_roles_update on custom_roles;
create policy custom_roles_update on custom_roles
  for update using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists custom_roles_delete on custom_roles;
create policy custom_roles_delete on custom_roles
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

alter table profiles drop constraint if exists profiles_role_check;
