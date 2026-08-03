-- =====================================================================
-- 0116 — Salary History: who made each rate change
--
-- salary_entries rows (Accounting Dashboard's "Salary History" / "Add
-- Rate Change") had no record of WHO entered a rate change, just the
-- effective date/reason/amount. Adds created_by (the actor's profile,
-- auto-stamped from the caller's own session — same "never trust a
-- client-supplied identity" pattern as it_tickets/csr_agent_notes) and
-- created_by_name (denormalized display name for easy listing, passed by
-- the client at insert time same as it_tickets.created_by_name).
--
-- Both columns are nullable — this table already has real historical rows
-- with no actor recorded (created before this migration), so those simply
-- show as unattributed rather than being backfilled or blocked.
--
-- Run once in the Supabase SQL Editor, after 0115.
-- =====================================================================

alter table salary_entries add column if not exists created_by uuid references profiles(id) on delete set null;
alter table salary_entries add column if not exists created_by_name text;

create or replace function salary_entries_stamp_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then
    new.created_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_salary_entries_created_by on salary_entries;
create trigger trg_salary_entries_created_by
  before insert on salary_entries
  for each row execute function salary_entries_stamp_created_by();
