-- =====================================================================
-- 0469 — payroll_period_locks: a pay period's payroll cutoff. Admin
-- declares, per period, the date and time (entered in Central Time) after
-- which nothing in that period can change: working hours, attendance,
-- custom lines (includables, reimbursements, deductions), tax lines,
-- manual pay, category counts, Hourly + OT mode, the Done/review mark,
-- notes to the employee, mileage, PTO, time corrections and pay-rate
-- changes dated in the period. There is no fixed "N days after the
-- period" rule — each period's cutoff is declared (holidays move it).
--
-- A locked period can be reopened by an Admin until a set time, with a
-- reason; it locks again on its own when that time passes. Every change to
-- a lock (set, moved, reopened, removed) is kept in
-- payroll_period_lock_history.
--
-- Enforced here, in the database, for every writer (the browser and the
-- server): enforce_payroll_lock() rejects inserts, updates and deletes on
-- the tables below whose date (or period) falls in a locked period.
-- Internal Notes (payroll_period_notes) stay writable after the lock.
--
-- Manage: Admin / Company SuperAdmin (and SuperAdmin). Read: everyone in
-- the company (Accounting, HR and the attendance pages show the lock).
--
-- Run once in the Supabase SQL Editor, after 0465 (0466–0468 are another
-- branch's; this one doesn't depend on them).
-- =====================================================================

create table if not exists payroll_period_locks (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  lock_at          timestamptz not null,
  reopened_until   timestamptz,
  reopen_reason    text,
  updated_by       uuid references profiles(id) on delete set null,
  updated_by_name  text,
  updated_at       timestamptz not null default now(),
  unique (company_id, period_start, period_end),
  check (period_end >= period_start),
  check (reopened_until is null or length(btrim(coalesce(reopen_reason, ''))) > 0)
);

create table if not exists payroll_period_lock_history (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  action           text not null check (action in ('set', 'moved', 'reopened', 'relocked', 'removed')),
  lock_at          timestamptz,
  reopened_until   timestamptz,
  reason           text,
  by_profile       uuid references profiles(id) on delete set null,
  by_name          text,
  at               timestamptz not null default now()
);
create index if not exists idx_payroll_period_lock_history_period
  on payroll_period_lock_history (company_id, period_start desc, at desc);

-- Who / when stamped by the database; every change written to history.
create or replace function payroll_period_locks_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  my_name text := (select coalesce(nullif(display_name, ''), email) from profiles where id = auth_profile_id());
  act text;
  r payroll_period_locks;
begin
  if tg_op = 'DELETE' then
    r := old;
    act := 'removed';
  else
    new.company_id := coalesce(new.company_id, auth_company_id());
    new.updated_by := me;
    new.updated_by_name := coalesce(my_name, new.updated_by_name);
    new.updated_at := now();
    if new.reopened_until is null then new.reopen_reason := null; end if;
    r := new;
    act := case
      when tg_op = 'INSERT' then 'set'
      when new.reopened_until is distinct from old.reopened_until and new.reopened_until is not null then 'reopened'
      when new.reopened_until is null and old.reopened_until is not null then 'relocked'
      else 'moved'
    end;
  end if;
  insert into payroll_period_lock_history (company_id, period_start, period_end, action, lock_at, reopened_until, reason, by_profile, by_name)
  values (r.company_id, r.period_start, r.period_end, act, r.lock_at, r.reopened_until, r.reopen_reason, me, my_name);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_payroll_period_locks_stamp on payroll_period_locks;
create trigger trg_payroll_period_locks_stamp before insert or update or delete on payroll_period_locks
  for each row execute function payroll_period_locks_stamp();

alter table payroll_period_locks enable row level security;
alter table payroll_period_locks force row level security;
alter table payroll_period_lock_history enable row level security;
alter table payroll_period_lock_history force row level security;

drop policy if exists payroll_period_locks_select on payroll_period_locks;
create policy payroll_period_locks_select on payroll_period_locks
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists payroll_period_locks_write on payroll_period_locks;
create policy payroll_period_locks_write on payroll_period_locks
  for all using (
    (company_id = auth_company_id() and (is_admin() or is_company_superadmin())) or is_superadmin()
  ) with check (
    (company_id = auth_company_id() and (is_admin() or is_company_superadmin())) or is_superadmin()
  );

drop policy if exists payroll_period_lock_history_select on payroll_period_lock_history;
create policy payroll_period_lock_history_select on payroll_period_lock_history
  for select using (company_id = auth_company_id() or is_superadmin());
-- History is written only by the stamp trigger (security definer).

-- ── Is anything between p_start and p_end locked right now? ─────────────
create or replace function payroll_locked_period(p_company uuid, p_start date, p_end date)
returns payroll_period_locks language sql stable security definer set search_path = public as $$
  select l.* from payroll_period_locks l
  where l.company_id = p_company
    and l.period_start <= p_end and l.period_end >= p_start
    and l.lock_at <= now()
    and (l.reopened_until is null or l.reopened_until <= now())
  order by l.period_start
  limit 1;
$$;

-- ── Generic guard. Trigger args: the row's start-date column, and either
-- its end-date column or 'open' (a change dated then applies from there on —
-- pay rates), or nothing (one date). Checks the old row and the new one, so
-- a row can't be moved into or out of a locked period either.
create or replace function enforce_payroll_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  row_list jsonb[];
  r jsonb;
  c uuid;
  s date;
  e date;
  hit payroll_period_locks;
  start_col text := tg_argv[0];
  end_col text := case when tg_nargs > 1 then tg_argv[1] else tg_argv[0] end;
begin
  row_list := case tg_op
    when 'INSERT' then array[to_jsonb(new)]
    when 'DELETE' then array[to_jsonb(old)]
    else array[to_jsonb(old), to_jsonb(new)]
  end;
  foreach r in array row_list loop
    s := nullif(r ->> start_col, '')::date;
    continue when s is null;
    e := case when end_col = 'open' then 'infinity'::date else coalesce(nullif(r ->> end_col, '')::date, s) end;
    c := coalesce(
      nullif(r ->> 'company_id', '')::uuid,
      (select company_id from profiles where id = nullif(r ->> 'profile_id', '')::uuid),
      auth_company_id()
    );
    continue when c is null;
    hit := payroll_locked_period(c, s, e);
    if hit.id is not null then
      raise exception 'Payroll for % – % is locked (cutoff passed %). Ask an Admin to reopen it.',
        to_char(hit.period_start, 'MM/DD/YYYY'), to_char(hit.period_end, 'MM/DD/YYYY'),
        to_char(hit.lock_at at time zone 'America/Chicago', 'MM/DD/YYYY HH12:MI AM') || ' CT'
        using errcode = 'P0001', hint = 'payroll_locked';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ── Attach to every table that feeds a period's pay ────────────────────
do $$
declare
  spec text[];
  specs text[][] := array[
    -- period-keyed payroll
    array['tech_custom_pay_items',       'period_start', 'period_end'],
    array['tech_manual_pay_items',       'period_start', 'period_end'],
    array['tech_category_overrides',     'period_start', 'period_end'],
    array['tech_tax_lines',              'period_start', 'period_end'],
    array['payroll_hourly_ot_overrides', 'period_start', 'period_end'],
    array['payroll_review_breakdowns',   'period_start', 'period_end'],
    array['payroll_review_marks',        'period_start', 'period_end'],
    array['payroll_adjustments',         'period_start', 'period_end'],
    array['payroll_employee_notes',      'period_start', 'period_end'],
    -- day-keyed attendance / hours / mileage
    array['timecard_entries',            'work_date',    'work_date'],
    array['trainee_timecard_entries',    'work_date',    'work_date'],
    array['timecard_corrections',        'work_date',    'work_date'],
    array['attendance_notes',            'note_date',    'note_date'],
    array['tech_daily_mileage',          'work_date',    'work_date'],
    array['mileage_entries',             'work_date',    'work_date'],
    -- leave covering days in the period
    array['pto_requests',                'start_date',   'end_date'],
    -- a pay rate dated in (or before) a locked period changes its pay
    array['salary_entries',              'effective_date', 'open']
  ];
begin
  foreach spec slice 1 in array specs loop
    if to_regclass('public.' || spec[1]) is null then
      raise notice 'payroll lock: % not found, skipped', spec[1];
      continue;
    end if;
    execute format('drop trigger if exists trg_payroll_lock on %I', spec[1]);
    execute format(
      'create trigger trg_payroll_lock before insert or update or delete on %I for each row execute function enforce_payroll_lock(%L, %L)',
      spec[1], spec[2], spec[3]
    );
  end loop;
end;
$$;
