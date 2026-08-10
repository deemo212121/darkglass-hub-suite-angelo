-- =====================================================================
-- 0151 — Per-company overrides for Dashboard-module role gates
--
-- DASHBOARD_ROLE_GATES (src/lib/dashboardAccess.ts) is a hardcoded list of
-- which roles may see/open each Dashboard-module submodule, identical for
-- every company. This lets each company customize it from Accessibility
-- Management (/m/admin/accessibility-management) without a code change.
--
-- Semantics: a submodule with NO rows for a company falls back to the
-- hardcoded default in DASHBOARD_ROLE_GATES. The client always
-- deletes-and-reinserts a submodule's COMPLETE allowed-role set on every
-- edit (never a partial diff) — so once a submodule has any rows at all,
-- those rows are the entire source of truth for it, not an addition to
-- the default.
--
-- Read access is company-wide (every signed-in user's client hydrates its
-- own effective gates on login/profile load, mirroring how
-- DASHBOARD_ROLE_GATES was baked into the bundle for everyone before this).
-- Write access matches ADMIN_MODULE_ROLES (m.$module.$submodule.tsx) — the
-- same Admin/SuperAdmin tier that can reach this page at all.
--
-- Run once in the Supabase SQL Editor, after 0150.
-- =====================================================================

create table if not exists dashboard_role_gate_overrides (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  submodule_slug  text not null,
  role            text not null,
  created_at      timestamptz not null default now(),
  unique (company_id, submodule_slug, role)
);
create index if not exists idx_dashboard_role_gate_overrides_company on dashboard_role_gate_overrides(company_id);

create or replace function dashboard_role_gate_overrides_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dashboard_role_gate_overrides_stamp on dashboard_role_gate_overrides;
create trigger trg_dashboard_role_gate_overrides_stamp before insert on dashboard_role_gate_overrides
  for each row execute function dashboard_role_gate_overrides_stamp();

alter table dashboard_role_gate_overrides enable row level security;
alter table dashboard_role_gate_overrides force row level security;

-- Any company member can read (needed to compute their own effective access).
drop policy if exists dashboard_role_gate_overrides_select on dashboard_role_gate_overrides;
create policy dashboard_role_gate_overrides_select on dashboard_role_gate_overrides
  for select using (company_id = auth_company_id() or is_superadmin());

-- Only Admin/SuperAdmin (or the platform SuperSuperAdmin) may edit gates.
drop policy if exists dashboard_role_gate_overrides_insert on dashboard_role_gate_overrides;
create policy dashboard_role_gate_overrides_insert on dashboard_role_gate_overrides
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists dashboard_role_gate_overrides_delete on dashboard_role_gate_overrides;
create policy dashboard_role_gate_overrides_delete on dashboard_role_gate_overrides
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );
