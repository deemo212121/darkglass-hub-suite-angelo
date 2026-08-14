-- =====================================================================
-- 0172 — Per-user notification opt-outs, layered on top of the
-- per-role routing in notification_role_gates (0171).
--
-- A user's role makes them a CANDIDATE for a notification trigger (see
-- notification_role_gates); this table lets an admin exclude a specific
-- person from it anyway, e.g. "most Parts Managers want the Restock
-- notice, but this one doesn't." Presence of a row = opted out; absence
-- = still gets it (if their role is eligible).
--
-- Keyed by firebase_uid (not profile id) since that's the recipient
-- identifier space most notification code already works in (Firestore
-- notifications, see lib/firebase/notifications.ts). Truck Stock's own
-- notify code is Supabase-table-backed and keyed by profile id instead —
-- it cross-references firebase_uid via its own profiles query rather
-- than this table needing two identifier columns.
--
-- Run once in the Supabase SQL Editor, after 0171.
-- =====================================================================

create table if not exists notification_user_opt_outs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  firebase_uid  text not null,
  trigger_key   text not null,
  created_at    timestamptz not null default now(),
  unique (company_id, firebase_uid, trigger_key)
);
create index if not exists idx_notification_user_opt_outs_company on notification_user_opt_outs(company_id);

create or replace function notification_user_opt_outs_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notification_user_opt_outs_stamp on notification_user_opt_outs;
create trigger trg_notification_user_opt_outs_stamp before insert on notification_user_opt_outs
  for each row execute function notification_user_opt_outs_stamp();

alter table notification_user_opt_outs enable row level security;
alter table notification_user_opt_outs force row level security;

-- Company-wide read (notify code filtering candidate lists needs this,
-- same as notification_role_gates).
drop policy if exists notification_user_opt_outs_select on notification_user_opt_outs;
create policy notification_user_opt_outs_select on notification_user_opt_outs
  for select using (company_id = auth_company_id() or is_superadmin());

-- Only Admin/SuperAdmin (or the platform SuperSuperAdmin) may edit —
-- same tier as notification_role_gates/module_role_gate_overrides.
drop policy if exists notification_user_opt_outs_insert on notification_user_opt_outs;
create policy notification_user_opt_outs_insert on notification_user_opt_outs
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );

drop policy if exists notification_user_opt_outs_delete on notification_user_opt_outs;
create policy notification_user_opt_outs_delete on notification_user_opt_outs
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (is_admin() or is_company_superadmin() or is_superadmin())
  );
