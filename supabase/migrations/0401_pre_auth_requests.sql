-- =====================================================================
-- 0401 — Pre-Auth: ServicePower Request for Authorization (Call Auth) drafts.
--
-- Claims → Pre-Auth fills in the same form as ServicePower's Call Auth
-- screen (repair description, why a higher rate, job code, estimated time,
-- the yes/no questions, labor / parts / mileage / travel) for a ticket,
-- saved here as a draft so anyone on Claims, Parts or BizOps can pick it up.
--
-- Sending to ServicePower is OFF: the Submit button only works for a
-- company whose companies.settings.spPreAuthSubmitEnabled is true, and
-- nothing in the app turns that on. sent_at / sp_response stay empty until
-- then.
--
-- managed_by_name: who is handling it (picked on the form, filterable in
-- the list).
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists pre_auth_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  ticket_no       text not null,
  status          text not null default 'Draft' check (status in ('Draft', 'Ready', 'Sent')),
  form            jsonb not null default '{}'::jsonb,
  total           numeric(12,2) not null default 0,
  managed_by_name text,
  created_by_name text,
  updated_by_name text,
  sent_at         timestamptz,
  sp_response     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, ticket_no)
);

-- Who is handling the Pre-Auth (picked on the form; defaults to whoever starts it).
alter table pre_auth_requests add column if not exists managed_by_name text;

create or replace function pre_auth_requests_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_pre_auth_requests_stamp on pre_auth_requests;
create trigger trg_pre_auth_requests_stamp before insert or update on pre_auth_requests
  for each row execute function pre_auth_requests_stamp_and_touch();

alter table pre_auth_requests enable row level security;
alter table pre_auth_requests force row level security;

drop policy if exists pre_auth_requests_select on pre_auth_requests;
create policy pre_auth_requests_select on pre_auth_requests
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists pre_auth_requests_insert on pre_auth_requests;
create policy pre_auth_requests_insert on pre_auth_requests
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists pre_auth_requests_update on pre_auth_requests;
create policy pre_auth_requests_update on pre_auth_requests
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists pre_auth_requests_delete on pre_auth_requests;
create policy pre_auth_requests_delete on pre_auth_requests
  for delete using (company_id = auth_company_id() or is_superadmin());
