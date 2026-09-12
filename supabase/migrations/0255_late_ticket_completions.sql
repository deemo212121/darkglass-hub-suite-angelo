-- =====================================================================
-- 0255 — Late ticket completions: Claims sign-off + payroll carry-forward
--
-- Tech payroll counts a ticket toward pay once its status reaches
-- CL-Claimed/CL-Completed (isCompletedStatus() in techPayroll.ts), computed
-- live from tickets.schedule_date every time a period is opened. If a
-- ticket's status only reaches one of those two AFTER the calendar week
-- (Sunday-Saturday) it was scheduled in has already ended, nobody is ever
-- told and there's no path to add it to pay later — it's silently missed
-- unless someone happens to re-open that exact past period.
--
-- This adds fully server-side detection (a trigger, so it doesn't depend on
-- anyone having the app open): the moment a ticket's status transitions into
-- CL-Claimed/CL-Completed and that transition happens after its own
-- scheduled week has ended, a pending row is inserted here. The app then:
--   - shows a blocking confirm/reject popup to CLAIMS-role users
--     (LateTicketCompletionModal.tsx, mounted in __root.tsx)
--   - on confirm, alerts Accounting (via the existing notifyRequestReviewers
--     pattern in employeeRequests.ts) and the ticket becomes eligible to be
--     folded into that technician's NEXT payroll run as a separate,
--     clearly-labeled carried-over line item (techPayroll.ts)
--   - on reject, the row is simply marked rejected — no alert, no payroll
--     impact, ever.
--
-- is_claims() mirrors is_finance()'s role-or-extra_roles pattern exactly
-- (0206_finance_can_edit_profiles.sql).
--
-- Run once in the Supabase SQL Editor, after 0254.
-- =====================================================================

create table if not exists late_ticket_completions (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id) on delete cascade,
  ticket_id               uuid not null references tickets(id) on delete cascade,
  ticket_no               text not null,
  technician_name         text,
  schedule_date           date,
  period_start            date not null,
  period_end              date not null,
  status                  text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  reviewed_by             uuid references profiles(id),
  reviewed_by_name        text,
  reviewed_at             timestamptz,
  carryover_payroll_run_id uuid references payroll_runs(id),
  created_at              timestamptz not null default now(),
  unique (ticket_id)
);

create index if not exists idx_late_ticket_completions_company on late_ticket_completions(company_id);
create index if not exists idx_late_ticket_completions_status on late_ticket_completions(company_id, status);
create index if not exists idx_late_ticket_completions_carryover on late_ticket_completions(technician_name)
  where status = 'confirmed' and carryover_payroll_run_id is null;

-- ---------- Detection trigger ----------
-- Sits alongside trg_ticket_audit (log_ticket_change(), 0001_init.sql) rather
-- than replacing it. Fires only on the one-time transition INTO
-- CL-Claimed/CL-Completed (re-saving the same completed status again, or
-- moving between the two, does not re-fire it — unique(ticket_id) also
-- guards this), and only when that transition happens strictly after the
-- Sunday-Saturday week containing the ticket's schedule_date has ended.
create or replace function check_late_ticket_completion()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_week_end date;
  v_was_completed boolean;
  v_is_completed boolean;
begin
  v_was_completed := lower(trim(coalesce(old.status, ''))) in ('cl-claimed', 'cl-completed');
  v_is_completed := lower(trim(coalesce(new.status, ''))) in ('cl-claimed', 'cl-completed');

  if v_is_completed and not v_was_completed and new.schedule_date is not null then
    v_week_end := new.schedule_date + (6 - extract(dow from new.schedule_date))::int;
    if current_date > v_week_end then
      insert into late_ticket_completions (
        company_id, ticket_id, ticket_no, technician_name,
        schedule_date, period_start, period_end
      )
      values (
        new.company_id, new.id, new.ticket_no, nullif(trim(new.technician), ''),
        new.schedule_date, v_week_end - 6, v_week_end
      )
      on conflict (ticket_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_late_ticket_completion on tickets;
create trigger trg_late_ticket_completion
  after update on tickets
  for each row execute function check_late_ticket_completion();

-- ---------- is_claims() ----------
create or replace function is_claims()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (
        role = any(array['CLAIMS', 'CLAIMS_MANAGER', 'CLAIMS_TEAM_LEADER'])
        or extra_roles && array['CLAIMS', 'CLAIMS_MANAGER', 'CLAIMS_TEAM_LEADER']
      )
  );
$$;

-- ---------- RLS ----------
-- Select is company-wide (not Claims-only): the blocking popup needs to read
-- this table for every logged-in user just to determine there's nothing to
-- show them. Only Claims/Admin/company-superadmin can actually resolve a row.
alter table late_ticket_completions enable row level security;
alter table late_ticket_completions force row level security;

drop policy if exists late_ticket_completions_select on late_ticket_completions;
create policy late_ticket_completions_select on late_ticket_completions
  for select using (company_id = auth_company_id() or is_superadmin());

-- is_finance() is included because Generate Payroll (Finance/Admin-only,
-- dashboardAccess.ts) is what stamps carryover_payroll_run_id once a
-- confirmed row is actually included in a run — a separate write from the
-- Claims confirm/reject decision itself, but on the same table/column set.
drop policy if exists late_ticket_completions_update on late_ticket_completions;
create policy late_ticket_completions_update on late_ticket_completions
  for update
  using (
    (company_id = auth_company_id() and (is_claims() or is_admin() or is_company_superadmin() or is_finance()))
    or is_superadmin()
  )
  with check (
    (company_id = auth_company_id() and (is_claims() or is_admin() or is_company_superadmin() or is_finance()))
    or is_superadmin()
  );

-- No insert/delete policy: rows are only ever created by the security-definer
-- trigger above and are never deleted (a rejected row stays as a record).
