-- Per-event call/text "Attempt" log for HR candidates. The "attempt" status
-- (0264_hr_candidates_attempt_status.sql) is a plain status value — setting
-- it AGAIN while a candidate is already "attempt" hits
-- hr_update_candidate_status()'s same-status early-return and writes
-- nothing at all (no elsif branch for "attempt" in that guard), so a 2nd,
-- 3rd, etc. attempt on the same candidate was previously invisible
-- everywhere, including the Hiring tab's "Generate Report" tile (which just
-- counts candidates currently AT status='attempt', windowed by when the
-- candidate itself was created — not by when any attempt happened).
--
-- This table gives every logged attempt its own row/timestamp, independent
-- of the candidate's current status, so:
--   - a candidate contacted both yesterday and today has TWO rows here,
--   - the Generate Report tile can count rows whose created_at falls inside
--     the selected report date range (e.g. "today" only) instead of a
--     current-status snapshot,
--   - the Hiring table can show a running "Nth attempt" count per
--     candidate.
--
-- Same simple company-scoped table shape as hr_candidate_field_edits
-- (0239) / hr_candidate_cv_forwards (0048) — insert-only log, no RPC
-- needed, company_id + attempted_by auto-stamped by trigger.

create table if not exists hr_candidate_attempts (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  candidate_id uuid not null references hr_candidates(id) on delete cascade,
  attempted_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_candidate_attempts_candidate on hr_candidate_attempts(candidate_id, created_at desc);
create index if not exists idx_hr_candidate_attempts_company_date on hr_candidate_attempts(company_id, created_at);

alter table hr_candidate_attempts enable row level security;
alter table hr_candidate_attempts force row level security;

create policy hr_candidate_attempts_select on hr_candidate_attempts
  for select using (company_id = auth_company_id() or is_superadmin());
create policy hr_candidate_attempts_insert on hr_candidate_attempts
  for insert with check (company_id = auth_company_id() or is_superadmin());

create or replace function hr_candidate_attempts_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from hr_candidates where id = new.candidate_id;
  if new.attempted_by is null then
    new.attempted_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists hr_candidate_attempts_stamp_trigger on hr_candidate_attempts;
create trigger hr_candidate_attempts_stamp_trigger
  before insert on hr_candidate_attempts
  for each row execute function hr_candidate_attempts_stamp();
