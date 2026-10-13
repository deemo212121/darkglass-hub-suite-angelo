-- =====================================================================
-- 0375 — Schedule history: Time In / Time Out Required too.
--
-- 0373 gave rest days an "effective from" date (rest_day_history). The
-- required times had the same problem: profiles.required_check_in/out held
-- only the CURRENT times, and every page judged every past day against
-- them — moving someone from 8:00 to 9:00 re-judged last month's lates.
--
-- rest_day_history now also keeps required_check_in / required_check_out,
-- so each row is the whole schedule in force from its effective date.
--   * Backfill: existing rows take the person's current times (nothing
--     changes for anyone on day one).
--   * The trigger now records a change to rest days OR required times
--     (any screen: user edit page, Master List Hours of Work, Manage
--     Working Hours, My Profile), effective today (Central) or from
--     set_profile_schedule()'s date.
--
-- Run once in the Supabase SQL Editor, after 0374 (needs 0373).
-- =====================================================================

alter table rest_day_history add column if not exists required_check_in text;
alter table rest_day_history add column if not exists required_check_out text;

update rest_day_history h
set required_check_in = p.required_check_in,
    required_check_out = p.required_check_out
from profiles p
where h.profile_id = p.id
  and h.required_check_in is null
  and h.required_check_out is null;

create or replace function record_rest_day_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from date;
begin
  if new.company_id is null then return new; end if;
  if tg_op = 'INSERT' then
    insert into rest_day_history (company_id, profile_id, off_days, required_check_in, required_check_out, effective_from, changed_by)
    values (new.company_id, new.id, coalesce(new.off_days, '{}'), new.required_check_in, new.required_check_out, date '2000-01-01', auth_profile_id())
    on conflict (profile_id, effective_from) do nothing;
    return new;
  end if;
  if new.off_days is not distinct from old.off_days
     and new.required_check_in is not distinct from old.required_check_in
     and new.required_check_out is not distinct from old.required_check_out then
    return new;
  end if;
  v_from := coalesce(
    nullif(current_setting('app.rest_day_effective_from', true), '')::date,
    (now() at time zone 'America/Chicago')::date
  );
  insert into rest_day_history (company_id, profile_id, off_days, required_check_in, required_check_out, effective_from, changed_by)
  values (new.company_id, new.id, coalesce(new.off_days, '{}'), new.required_check_in, new.required_check_out, v_from, auth_profile_id())
  on conflict (profile_id, effective_from) do update
    set off_days = excluded.off_days,
        required_check_in = excluded.required_check_in,
        required_check_out = excluded.required_check_out,
        changed_by = excluded.changed_by,
        created_at = now();
  return new;
end;
$$;

drop trigger if exists trg_record_rest_day_change on profiles;
create trigger trg_record_rest_day_change
  after insert or update of off_days, required_check_in, required_check_out on profiles
  for each row execute function record_rest_day_change();

-- Change rest days and/or required times with an "Effective from" date.
-- Runs as the caller (normal profile RLS applies).
create or replace function set_profile_schedule(
  p_profile_id uuid,
  p_off_days int[],
  p_check_in text,
  p_check_out text,
  p_effective_from date
)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform set_config('app.rest_day_effective_from', coalesce(p_effective_from::text, ''), true);
  update profiles
  set off_days = coalesce(p_off_days, '{}'),
      required_check_in = p_check_in,
      required_check_out = p_check_out
  where id = p_profile_id;
  perform set_config('app.rest_day_effective_from', '', true);
end;
$$;

grant execute on function set_profile_schedule(uuid, int[], text, text, date) to authenticated;
