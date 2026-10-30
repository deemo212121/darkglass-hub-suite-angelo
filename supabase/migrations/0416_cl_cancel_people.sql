-- =====================================================================
-- 0416 — Who can set a ticket to CL-Cancelled, by name.
--
-- CL-Cancelled is normally for BizOps (Team Leader / Manager / Senior
-- Manager) plus Admin / Super Admin, by user type (roleLabels.ts
-- canSetCancelledStatus). Admin → Approval Chain → Philippines now also keeps
-- an explicit list of people who can set it whatever their user type — and
-- the trainee rule doesn't hold them back. Same shape and rules as
-- approval_chain_top_approvers (0336): company-scoped, everyone in the company
-- can read it, Admin / Super Admin edit it.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists cl_cancel_people (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (company_id, profile_id)
);

create or replace function cl_cancel_people_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cl_cancel_people_stamp on cl_cancel_people;
create trigger trg_cl_cancel_people_stamp before insert on cl_cancel_people
  for each row execute function cl_cancel_people_stamp();

alter table cl_cancel_people enable row level security;
alter table cl_cancel_people force row level security;
drop policy if exists cl_cancel_people_select on cl_cancel_people;
create policy cl_cancel_people_select on cl_cancel_people
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists cl_cancel_people_insert on cl_cancel_people;
create policy cl_cancel_people_insert on cl_cancel_people
  for insert with check ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));
drop policy if exists cl_cancel_people_delete on cl_cancel_people;
create policy cl_cancel_people_delete on cl_cancel_people
  for delete using ((company_id = auth_company_id() or is_superadmin()) and (is_admin() or is_company_superadmin() or is_superadmin()));
