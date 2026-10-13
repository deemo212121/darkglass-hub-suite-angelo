-- =====================================================================
-- 0373 — Rest day history ("effective from").
--
-- profiles.off_days only held the CURRENT rest days, and every page checked
-- every date — past ones included — against it. Changing someone from
-- Sat/Sun to Thu/Fri in October turned their September Saturdays and
-- Sundays into absences.
--
-- rest_day_history keeps each schedule with the date it took effect. Pages
-- look up "rest days on this date" (src/lib/restDays.ts). profiles.off_days
-- stays as the current value, so nothing that still reads it breaks.
--
--   * Backfill: everyone's current rest days, effective from 2000-01-01 —
--     nothing changes for anyone until a rest-day change is recorded.
--   * New accounts get their rest days from 2000-01-01 too.
--   * Any change to profiles.off_days is recorded automatically (trigger),
--     effective today (Central) — or from the date passed to
--     set_profile_rest_days(), which the app uses for "Effective from".
--   * HR can add an earlier schedule by hand for someone whose rest days
--     were changed before this existed.
--
-- Run once in the Supabase SQL Editor, after 0372 (renumbered from 0371, which is the Reports Library).
-- =====================================================================

create table if not exists rest_day_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  off_days int[] not null default '{}',
  effective_from date not null,
  changed_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (profile_id, effective_from)
);

create index if not exists rest_day_history_profile_idx on rest_day_history (profile_id, effective_from);

alter table rest_day_history enable row level security;

drop policy if exists rest_day_history_select on rest_day_history;
create policy rest_day_history_select on rest_day_history
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists rest_day_history_insert on rest_day_history;
create policy rest_day_history_insert on rest_day_history
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists rest_day_history_update on rest_day_history;
create policy rest_day_history_update on rest_day_history
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists rest_day_history_delete on rest_day_history;
create policy rest_day_history_delete on rest_day_history
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Backfill: current rest days, from the beginning ----------
insert into rest_day_history (company_id, profile_id, off_days, effective_from)
select p.company_id, p.id, coalesce(p.off_days, '{}'), date '2000-01-01'
from profiles p
where p.company_id is not null
on conflict (profile_id, effective_from) do nothing;

-- ---------- Record every rest-day change ----------
create or replace function record_rest_day_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from date;
begin
  if new.company_id is null then return new; end if;
  if tg_op = 'INSERT' then
    insert into rest_day_history (company_id, profile_id, off_days, effective_from, changed_by)
    values (new.company_id, new.id, coalesce(new.off_days, '{}'), date '2000-01-01', auth_profile_id())
    on conflict (profile_id, effective_from) do nothing;
    return new;
  end if;
  if new.off_days is not distinct from old.off_days then return new; end if;
  -- "Effective from" chosen in the app (set_profile_rest_days), else today in Central time.
  v_from := coalesce(
    nullif(current_setting('app.rest_day_effective_from', true), '')::date,
    (now() at time zone 'America/Chicago')::date
  );
  insert into rest_day_history (company_id, profile_id, off_days, effective_from, changed_by)
  values (new.company_id, new.id, coalesce(new.off_days, '{}'), v_from, auth_profile_id())
  on conflict (profile_id, effective_from) do update
    set off_days = excluded.off_days, changed_by = excluded.changed_by, created_at = now();
  return new;
end;
$$;

drop trigger if exists trg_record_rest_day_change on profiles;
create trigger trg_record_rest_day_change
  after insert or update of off_days on profiles
  for each row execute function record_rest_day_change();

-- ---------- Change rest days with an "Effective from" date ----------
-- Runs as the caller (normal profile RLS applies); only sets the date the
-- trigger above records the change under.
create or replace function set_profile_rest_days(p_profile_id uuid, p_off_days int[], p_effective_from date)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform set_config('app.rest_day_effective_from', coalesce(p_effective_from::text, ''), true);
  update profiles set off_days = coalesce(p_off_days, '{}') where id = p_profile_id;
  perform set_config('app.rest_day_effective_from', '', true);
end;
$$;

grant execute on function set_profile_rest_days(uuid, int[], date) to authenticated;
