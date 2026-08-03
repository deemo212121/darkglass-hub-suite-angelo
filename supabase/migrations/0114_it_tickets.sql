-- =====================================================================
-- 0114 — IT Tickets: any employee can submit one (from My Profile), a
-- dedicated "IT Tickets" dashboard page (src/components/ItTicketsPage.tsx)
-- lists all of them for privileged viewers:
--   - the ORIGINAL SUBMITTER can always see their own ticket (read-only)
--   - Senior-tier managers (SENIOR_MANAGER, SENIOR_BRANCH_MANAGER,
--     BIZOPS_SENIOR_MANAGER) can see EVERY ticket, but read-only
--   - IT / Admin / Superadmin can see every ticket AND edit/delete/assign it
--
-- company_id/created_by/created_by_name auto-stamped from the caller's
-- session (same pattern as csr_agent_notes/live_chat_saved_replies), so a
-- submitter can never claim a different company or impersonate someone
-- else's name on their own ticket.
--
-- Run once in the Supabase SQL Editor, after 0113.
-- =====================================================================

create table if not exists it_tickets (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  created_by        uuid not null references profiles(id) on delete cascade,
  created_by_name   text not null,
  subject           text not null,
  description       text not null,
  priority          text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status            text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to       uuid references profiles(id) on delete set null,
  assigned_to_name  text,
  resolution_notes  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_it_tickets_company on it_tickets(company_id, created_at desc);
create index if not exists idx_it_tickets_created_by on it_tickets(created_by);

alter table it_tickets enable row level security;
alter table it_tickets force row level security;

create or replace function it_tickets_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if new.company_id is null then
      new.company_id := auth_company_id();
    end if;
    if new.created_by is null then
      new.created_by := auth_profile_id();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_it_tickets_stamp on it_tickets;
create trigger trg_it_tickets_stamp before insert or update on it_tickets
  for each row execute function it_tickets_stamp_and_touch();

-- Senior-tier managers get read-only visibility into every ticket — checks
-- role OR extra_roles, same "primary-or-secondary" convention as
-- is_csr_wide_visibility() (migration 0080).
create or replace function is_it_ticket_senior_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select
    upper(role) in ('SENIOR_MANAGER', 'SENIOR_BRANCH_MANAGER', 'BIZOPS_SENIOR_MANAGER')
    or exists (
      select 1 from unnest(coalesce(extra_roles, '{}')) r
      where upper(r) in ('SENIOR_MANAGER', 'SENIOR_BRANCH_MANAGER', 'BIZOPS_SENIOR_MANAGER')
    )
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

-- IT / Admin get full view + edit + delete + assign.
create or replace function is_it_ticket_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select
    upper(role) in ('IT', 'ADMIN', 'SUPERADMIN')
    or exists (
      select 1 from unnest(coalesce(extra_roles, '{}')) r
      where upper(r) in ('IT', 'ADMIN', 'SUPERADMIN')
    )
  from profiles
  where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
  limit 1;
$$;

drop policy if exists it_tickets_select on it_tickets;
create policy it_tickets_select on it_tickets
  for select using (
    is_superadmin()
    or (
      company_id = auth_company_id()
      and (
        created_by = auth_profile_id()
        or is_it_ticket_senior_viewer()
        or is_it_ticket_admin()
      )
    )
  );

-- Any authenticated company member can submit a ticket about themselves —
-- the stamp trigger above overwrites company_id/created_by regardless of
-- whatever the client sends, so this is really just a company-membership check.
drop policy if exists it_tickets_insert on it_tickets;
create policy it_tickets_insert on it_tickets
  for insert with check (company_id = auth_company_id() or is_superadmin());

-- Only IT/Admin/Superadmin may change a ticket (status, assignment,
-- resolution notes, etc) — Senior Managers and the original submitter are
-- both read-only, per the select policy above already allowing them to
-- SEE it without granting write access here.
drop policy if exists it_tickets_update on it_tickets;
create policy it_tickets_update on it_tickets
  for update
  using (is_superadmin() or (company_id = auth_company_id() and is_it_ticket_admin()))
  with check (is_superadmin() or (company_id = auth_company_id() and is_it_ticket_admin()));

drop policy if exists it_tickets_delete on it_tickets;
create policy it_tickets_delete on it_tickets
  for delete using (is_superadmin() or (company_id = auth_company_id() and is_it_ticket_admin()));
