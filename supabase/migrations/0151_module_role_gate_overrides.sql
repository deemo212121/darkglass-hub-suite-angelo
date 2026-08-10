-- =====================================================================
-- 0151 — Per-company overrides for module/submodule role gates
--
-- Previously only the Dashboard module had any per-submodule role-gate
-- concept at all (DASHBOARD_ROLE_GATES, hardcoded, identical for every
-- company); every other module's submodules were open to any company
-- member (aside from the separate CSR-department restriction and a
-- handful of one-off page-specific checks like the Admin-module gate).
-- This lets a company restrict ANY module's ANY submodule to specific
-- roles from Accessibility Management (/m/admin/accessibility-management)
-- without a code change.
--
-- Semantics: a (module, submodule) with NO rows for a company is open to
-- everyone (Dashboard submodules instead fall back to their hardcoded
-- DASHBOARD_ROLE_GATES default). The client always deletes-and-reinserts
-- a submodule's COMPLETE allowed-role set on every edit (never a partial
-- diff) — so once a submodule has any rows at all, those rows are the
-- entire source of truth for it.
--
-- This is purely an ADDITIONAL, optional restriction layered on top of
-- existing hardcoded gates (Admin-module, User Management, Company
-- Settings, CSR) — it can only narrow access further, never grant access
-- past one of those, since m.$module.$submodule.tsx requires ALL
-- applicable gates to pass.
--
-- Read access is company-wide (every signed-in user's client hydrates its
-- own effective gates on login/profile load). Write access matches
-- ADMIN_MODULE_ROLES (m.$module.$submodule.tsx) — the same Admin/SuperAdmin
-- tier that can reach this page at all.
--
-- Run once in the Supabase SQL Editor, after 0150.
-- =====================================================================

create table if not exists module_role_gate_overrides (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  module_slug     text not null,
  submodule_slug  text not null,
  role            text not null,
  created_at      timestamptz not null default now(),
  unique (company_id, module_slug, submodule_slug, role)
);
create index if not exists idx_module_role_gate_overrides_company on module_role_gate_overrides(company_id);

create or replace function module_role_gate_overrides_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_module_role_gate_overrides_stamp on module_role_gate_overrides;
create trigger trg_module_role_gate_overrides_stamp before insert on module_role_gate_overrides
  for each row execute function module_role_gate_overrides_stamp();

alter table module_role_gate_overrides enable row level security;
alter table module_role_gate_overrides force row level security;

-- Any company member can read (needed to compute their own effective access).
drop policy if exists module_role_gate_overrides_select on module_role_gate_overrides;
create policy module_role_gate_overrides_select on module_role_gate_overrides
  for select using (company_id = auth_company_id() or is_superadmin());

-- Only Admin/SuperAdmin (or the platform SuperSuperAdmin) may edit gates.
drop policy if exists module_role_gate_overrides_insert on module_role_gate_overrides;
create policy module_role_gate_overrides_insert on module_role_gate_overrides
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists module_role_gate_overrides_delete on module_role_gate_overrides;
create policy module_role_gate_overrides_delete on module_role_gate_overrides
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );
