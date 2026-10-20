-- =====================================================================
-- 0399 — payroll_employee_notes: a note from Payroll to one employee
--         for one pay period
--
-- Finance (2026-10-20) needs to tell an employee things like "You were
-- overpaid by $138.79. It will be deducted from your next pay." in a way
-- they can't miss. Written in Accounting Dashboard → Payroll History;
-- shown to the employee in Self-Service → My Payroll as a banner (and on
-- their payslip) until they click "I've read this", which stamps
-- acknowledged_at so Payroll can see it was read.
--
-- Keyed by period, NOT by payroll run: a note must survive a regenerate
-- that drops the person's payroll_line_items row.
--
-- Editing the text clears acknowledged_at, so a changed note has to be
-- read again.
--
-- Run once in the Supabase SQL Editor, after 0398.
-- (janeyyy16's 0396, renumbered — this repo's 0396 is
--  expense_review_accounting_only. Already applied on the shared database
--  2026-10-20.)
-- =====================================================================

create table if not exists payroll_employee_notes (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  profile_id       uuid not null references profiles(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  body             text not null default '',
  created_by       uuid references profiles(id) on delete set null,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  unique (company_id, profile_id, period_start, period_end)
);

create index if not exists idx_payroll_employee_notes_profile
  on payroll_employee_notes (profile_id, period_start desc);

create or replace function payroll_employee_notes_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  -- updated_at tracks the TEXT only — an acknowledgement doesn't touch it.
  if tg_op = 'INSERT' then
    new.updated_at := now();
  elsif new.body is distinct from old.body then
    new.updated_at := now();
    new.acknowledged_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_payroll_employee_notes_stamp on payroll_employee_notes;
create trigger trg_payroll_employee_notes_stamp before insert or update on payroll_employee_notes
  for each row execute function payroll_employee_notes_stamp();

-- ---------- RLS ----------
alter table payroll_employee_notes enable row level security;
alter table payroll_employee_notes force row level security;

-- The employee reads their own notes; Admin/Finance read everyone's in their company.
drop policy if exists payroll_employee_notes_select on payroll_employee_notes;
create policy payroll_employee_notes_select on payroll_employee_notes
  for select using (
    profile_id = auth_profile_id()
    or (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

-- Only Admin/Finance write them.
drop policy if exists payroll_employee_notes_write on payroll_employee_notes;
create policy payroll_employee_notes_write on payroll_employee_notes
  for all
  using (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_admin() or is_finance() or is_company_superadmin()))
    or is_superadmin()
  );

-- The employee's "I've read this" — can only stamp their own note.
create or replace function acknowledge_payroll_note(p_note_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update payroll_employee_notes
  set acknowledged_at = now()
  where id = p_note_id
    and profile_id = auth_profile_id()
    and acknowledged_at is null;
end;
$$;

grant execute on function acknowledge_payroll_note(uuid) to authenticated;
