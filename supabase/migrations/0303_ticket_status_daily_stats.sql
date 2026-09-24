-- =====================================================================
-- 0303 — Per-day "funnel" counters for the Tickets → Operation page
-- (src/components/TicketOperationReport.tsx). For each repair status,
-- tracks how many tickets have moved INTO it today (entered_count, on
-- top of whatever was already sitting in that status at the start of
-- the day — baseline_count) and how many have since moved OUT of it
-- today (left_count). Shown in the UI as leftCount / (baselineCount +
-- enteredCount) — e.g. "TR-Need PO" starts the day at 0/100 (100
-- tickets already in it, none processed yet); when one moves to
-- "OP-Waiting for Part", Need PO becomes 1/100 (one left) and Waiting
-- for Part becomes 0/101 (one arrived, denominator grows).
--
-- One row per (company, stat_date, status) — stat_date is the UTC
-- calendar day (same convention every other daily report in this app
-- uses, e.g. ReportOperationsDaily.tsx's toISOString().slice(0,10)),
-- maintained incrementally by a trigger rather than computed on read,
-- since reconstructing "who was in what status at midnight" after the
-- fact would require replaying the entire ticket_audit_log per ticket.
--
-- Deliberately a SEPARATE trigger from the existing trg_ticket_audit /
-- log_ticket_change() (0001_init.sql) rather than folding into it —
-- zero risk to that trigger's existing status_changed_by/_at behavior,
-- easy to disable independently if this ever needs to be turned off.
-- Same company-scoped RLS shape as parts_daily_issues_log (0290).
--
-- Known limitation: only counts STATUS CHANGES, not ticket creation —
-- a brand-new ticket created directly into a tracked status doesn't
-- bump that status's entered_count until/unless it later changes
-- status. Matches the user's own framing ("when that status is
-- changed"); revisit if new-ticket volume needs to show up same-day.
--
-- Run once in the Supabase SQL Editor, after 0302.
-- =====================================================================

create table if not exists ticket_status_daily_stats (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  stat_date       date not null,
  status          text not null,
  baseline_count  integer not null default 0,
  entered_count   integer not null default 0,
  left_count      integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (company_id, stat_date, status)
);
create index if not exists idx_ticket_status_daily_stats_lookup
  on ticket_status_daily_stats(company_id, stat_date);

-- ---------- Maintain the table on every ticket status change ----------
create or replace function bump_ticket_status_daily_stats()
returns trigger language plpgsql as $$
declare
  v_stat_date date := (now() at time zone 'utc')::date;
  v_has_snapshot boolean;
begin
  select exists(
    select 1 from ticket_status_daily_stats
    where company_id = new.company_id and stat_date = v_stat_date
  ) into v_has_snapshot;

  -- First status change of the day for this company: snapshot today's
  -- starting point. This fires from a BEFORE UPDATE trigger, so the
  -- `tickets` table on disk still reflects every row's PRE-change
  -- status (including this one) — an accurate "as of start of day"
  -- count, not just "as of right now".
  if not v_has_snapshot then
    insert into ticket_status_daily_stats (company_id, stat_date, status, baseline_count)
    select company_id, v_stat_date, status, count(*)
    from tickets
    where company_id = new.company_id
    group by company_id, status
    on conflict (company_id, stat_date, status) do nothing;
  end if;

  insert into ticket_status_daily_stats (company_id, stat_date, status, left_count)
  values (new.company_id, v_stat_date, old.status, 1)
  on conflict (company_id, stat_date, status)
    do update set left_count = ticket_status_daily_stats.left_count + 1, updated_at = now();

  insert into ticket_status_daily_stats (company_id, stat_date, status, entered_count)
  values (new.company_id, v_stat_date, new.status, 1)
  on conflict (company_id, stat_date, status)
    do update set entered_count = ticket_status_daily_stats.entered_count + 1, updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_ticket_status_daily_stats on tickets;
create trigger trg_ticket_status_daily_stats
  before update on tickets
  for each row
  when (new.status is distinct from old.status)
  execute function bump_ticket_status_daily_stats();

-- ---------- RLS: company-scoped, same pattern as parts_daily_issues_log (0290) ----------
alter table ticket_status_daily_stats enable row level security;
alter table ticket_status_daily_stats force row level security;

drop policy if exists ticket_status_daily_stats_select on ticket_status_daily_stats;
create policy ticket_status_daily_stats_select on ticket_status_daily_stats
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists ticket_status_daily_stats_insert on ticket_status_daily_stats;
create policy ticket_status_daily_stats_insert on ticket_status_daily_stats
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ticket_status_daily_stats_update on ticket_status_daily_stats;
create policy ticket_status_daily_stats_update on ticket_status_daily_stats
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists ticket_status_daily_stats_delete on ticket_status_daily_stats;
create policy ticket_status_daily_stats_delete on ticket_status_daily_stats
  for delete using (company_id = auth_company_id() or is_superadmin());
