-- =====================================================================
-- 0171 — Per-company overrides for which role(s) get notified by each
-- of the app's role-configurable notification triggers.
--
-- Same shape/semantics as module_role_gate_overrides (0151): a trigger
-- with no override rows falls back to its own hardcoded default role
-- list (see NOTIFICATION_TRIGGERS in src/lib/supabase/
-- notificationRoleGates.ts). The client always deletes-and-reinserts a
-- trigger's COMPLETE allowed-role set on every edit, never a partial diff.
--
-- Scope is deliberately limited to notifications that are genuinely
-- "which role should hear about this" in nature (Restock, Cross-Branch
-- Inventory Request, the Parts "Done" digest, Truck Stock's approver
-- list) — several other notifications in the app go to named
-- individuals or back to whoever requested something, not a
-- configurable role, and aren't covered by this table.
--
-- Run once in the Supabase SQL Editor, after 0170.
-- =====================================================================

create table if not exists notification_role_gates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  trigger_key   text not null,
  role          text not null,
  created_at    timestamptz not null default now(),
  unique (company_id, trigger_key, role)
);
create index if not exists idx_notification_role_gates_company on notification_role_gates(company_id);

create or replace function notification_role_gates_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notification_role_gates_stamp on notification_role_gates;
create trigger trg_notification_role_gates_stamp before insert on notification_role_gates
  for each row execute function notification_role_gates_stamp();

alter table notification_role_gates enable row level security;
alter table notification_role_gates force row level security;

-- Any company member can read (needed to compute effective recipients).
drop policy if exists notification_role_gates_select on notification_role_gates;
create policy notification_role_gates_select on notification_role_gates
  for select using (company_id = auth_company_id() or is_superadmin());

-- Only Admin/SuperAdmin (or the platform SuperSuperAdmin) may edit gates —
-- same tier as module_role_gate_overrides.
drop policy if exists notification_role_gates_insert on notification_role_gates;
create policy notification_role_gates_insert on notification_role_gates
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists notification_role_gates_delete on notification_role_gates;
create policy notification_role_gates_delete on notification_role_gates
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );
