-- =====================================================================
-- 0475 — ServicePower auto-pull + pull log.
--
-- (1) sp_pull_log — one row for every ticket a ServicePower pull ADDED to
--     AHS: the hourly auto-pull (server/servicePowerAutoPull.ts) and the
--     Data Migration "(Ticket) Service Power Migration" button. Data
--     Migration lists them by the call's received date. Pulls never change
--     an existing ticket, so there is nothing else to log.
--
-- (2) set_company_sp_auto_pull(sources, from) — Admin / Super Admin turn
--     the hourly auto-pull on or off and pick its sources (stored in
--     companies.settings.spAutoPull). No sources = off.
--
-- (3) Turns the auto-pull ON for AH Solutions: GE, SQUARE TRADE and
--     ELECTROLUX calls received from Friday 2026-11-20 on (user's request,
--     2026-11-24). Only if it was never set, so running this file again
--     never undoes a later change made on the Data Migration page.
--
-- No ticket, customer or existing row is changed or deleted.
--
-- Run once in the Supabase SQL Editor, after 0474. Safe to run again.
-- =====================================================================

create table if not exists sp_pull_log (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  ticket_no        text not null,
  ticket_id        uuid references tickets(id) on delete set null,
  -- ServicePower Work Order Source as saved on the ticket (GE, SQUARE TRADE …)
  source           text,
  -- the call's received date in ServicePower (= tickets.call_received_date)
  call_date        date,
  branch           text,
  -- 'auto' = the hourly auto-pull, 'manual' = the Data Migration button
  mode             text not null default 'manual' check (mode in ('auto', 'manual')),
  pulled_by_name   text,
  pulled_at        timestamptz not null default now()
);
create index if not exists idx_sp_pull_log_call_date on sp_pull_log(company_id, call_date);
create index if not exists idx_sp_pull_log_pulled_at on sp_pull_log(company_id, pulled_at desc);

drop trigger if exists trg_sp_pull_log_company on sp_pull_log;
create trigger trg_sp_pull_log_company
  before insert on sp_pull_log
  for each row execute function set_company_id();

-- Who pulled it: the signed-in person, or "Auto pull" for the server job.
create or replace function sp_pull_log_fill_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pulled_by_name is null or btrim(new.pulled_by_name) = '' then
    new.pulled_by_name := coalesce(
      (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id()),
      case when new.mode = 'auto' then 'Auto pull' else 'System' end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sp_pull_log_name on sp_pull_log;
create trigger trg_sp_pull_log_name
  before insert on sp_pull_log
  for each row execute function sp_pull_log_fill_name();

revoke all on function sp_pull_log_fill_name() from public, anon, authenticated;

alter table sp_pull_log enable row level security;
revoke all on sp_pull_log from anon;
revoke update, delete on sp_pull_log from authenticated;
grant select, insert on sp_pull_log to authenticated;

drop policy if exists sp_pull_log_select on sp_pull_log;
create policy sp_pull_log_select on sp_pull_log
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists sp_pull_log_insert on sp_pull_log;
create policy sp_pull_log_insert on sp_pull_log
  for insert with check (company_id = auth_company_id() and mode = 'manual');

-- ---------------------------------------------------------------------
create or replace function set_company_sp_auto_pull(p_sources text[], p_from date default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sources text[];
begin
  if not (is_admin() or is_company_superadmin() or is_superadmin()) then
    raise exception 'Only an Admin or Super Admin can change the ServicePower auto-pull.';
  end if;
  select coalesce(array_agg(distinct upper(btrim(s))), '{}') into v_sources
  from unnest(coalesce(p_sources, '{}')) s
  where btrim(s) <> '';

  if cardinality(v_sources) = 0 then
    update companies set settings = coalesce(settings, '{}'::jsonb) - 'spAutoPull'
    where id = auth_company_id();
  else
    update companies
    set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
      'spAutoPull', jsonb_build_object(
        'sources', to_jsonb(v_sources),
        'from', to_char(coalesce(p_from, (settings->'spAutoPull'->>'from')::date, current_date), 'YYYY-MM-DD')
      )
    )
    where id = auth_company_id();
  end if;
end;
$$;

revoke all on function set_company_sp_auto_pull(text[], date) from public, anon;
grant execute on function set_company_sp_auto_pull(text[], date) to authenticated;

-- ---------------------------------------------------------------------
update companies
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'spAutoPull', jsonb_build_object(
    'sources', jsonb_build_array('GE', 'SQUARE TRADE', 'ELECTROLUX'),
    'from', '2026-11-20'
  )
)
where company_name = 'AH Solutions'
  and not (coalesce(settings, '{}'::jsonb) ? 'spAutoPull');

notify pgrst, 'reload schema';
