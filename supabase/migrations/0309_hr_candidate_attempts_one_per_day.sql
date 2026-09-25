-- One logged call/text attempt per candidate per (Central-time) calendar
-- day — HR's own rule: attempting again later the same day doesn't count
-- as a 2nd attempt, only the next calendar day does. Enforced with a real
-- unique constraint, not just a client-side check, so a double-click or a
-- second HR user working the same candidate can't slip two rows in for the
-- same day.
--
-- attempt_date is computed in DEFAULT_ATTENDANCE_TIMEZONE (America/Chicago
-- — src/lib/attendanceGrace.ts), the same business-day convention the rest
-- of the app defaults to, not whatever timezone the DB connection happens
-- to be in.

alter table hr_candidate_attempts add column if not exists attempt_date date;

create or replace function hr_candidate_attempts_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from hr_candidates where id = new.candidate_id;
  if new.attempted_by is null then
    new.attempted_by := auth_profile_id();
  end if;
  -- created_at's own column default (now()) has already been resolved by
  -- the time a BEFORE INSERT trigger sees NEW, so this reads the real
  -- insert timestamp even though the client never sets created_at itself.
  new.attempt_date := (new.created_at at time zone 'America/Chicago')::date;
  return new;
end;
$$;

-- Backfill any rows already logged before this migration existed.
update hr_candidate_attempts set attempt_date = (created_at at time zone 'America/Chicago')::date where attempt_date is null;

alter table hr_candidate_attempts alter column attempt_date set not null;

-- If two attempts somehow already landed on the same candidate+day before
-- this constraint existed, keep only the earliest one so the unique index
-- below can be created without failing on pre-existing duplicates.
delete from hr_candidate_attempts a using hr_candidate_attempts b
  where a.candidate_id = b.candidate_id and a.attempt_date = b.attempt_date and a.created_at > b.created_at;

create unique index if not exists idx_hr_candidate_attempts_one_per_day on hr_candidate_attempts(candidate_id, attempt_date);
