-- =====================================================================
-- 0465 — payroll_period_notes: Accounting's internal notes on one
-- employee's pay period, written from the Tech Activity Report (e.g. why
-- the paystub and AHS differ, what was sent back to payroll). Each note
-- keeps who wrote it and when; the author can delete their own note.
--
-- Read / write: Admin, Finance, Company SuperAdmin (same as Reviewed
-- Periods, migration 0392). Employees never see these.
--
-- Run once in the Supabase SQL Editor, after 0464.
-- =====================================================================

create table if not exists payroll_period_notes (
  id              uuid primary key default uuid_generate_v4(),
  company_id      uuid not null references companies(id) on delete cascade,
  profile_id      uuid not null references profiles(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  body            text not null check (length(btrim(body)) > 0),
  created_by      uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_payroll_period_notes_period
  on payroll_period_notes (company_id, profile_id, period_start, period_end);

-- Author and time are stamped by the database, not sent by the browser.
create or replace function payroll_period_notes_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.company_id := coalesce(new.company_id, auth_company_id());
  new.created_by := auth_profile_id();
  new.created_by_name := coalesce(
    (select coalesce(nullif(display_name, ''), email) from profiles where id = auth_profile_id()),
    new.created_by_name
  );
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payroll_period_notes_stamp on payroll_period_notes;
create trigger trg_payroll_period_notes_stamp before insert on payroll_period_notes
  for each row execute function payroll_period_notes_stamp();

alter table payroll_period_notes enable row level security;
alter table payroll_period_notes force row level security;

drop policy if exists payroll_period_notes_select on payroll_period_notes;
create policy payroll_period_notes_select on payroll_period_notes
  for select using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists payroll_period_notes_insert on payroll_period_notes;
create policy payroll_period_notes_insert on payroll_period_notes
  for insert with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

drop policy if exists payroll_period_notes_delete on payroll_period_notes;
create policy payroll_period_notes_delete on payroll_period_notes
  for delete using (company_id = auth_company_id() and created_by = auth_profile_id());
