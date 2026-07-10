-- =====================================================================
-- 0047 — HR Hiring Reports: EOD/EOM reporting on top of hr_candidates
--
-- Adds two new statuses to the existing candidate pipeline (training,
-- on_hold), a per-Position+Branch "Staff Needed" counter HR maintains by
-- hand, and an append-only status-history log so EOD/EOM reports stay
-- accurate for a past date even after a candidate's status has since
-- moved on — the whole point of "hired on the 3rd" not silently
-- disappearing from the 3rd's report just because they were later
-- rejected/reversed.
--
-- Status transitions (and the Staff Needed +/-1 side effect) go through
-- the hr_update_candidate_status() RPC below rather than a plain
-- `update hr_candidates set status = ...`, so the history log and the
-- Staff Needed counter can never drift out of sync with the candidate's
-- actual status — both happen atomically in one function, guarded so a
-- no-op "change" (same status re-saved) never logs a duplicate transition
-- or double-counts a hire.
--
-- Run once in the Supabase SQL Editor, after 0046.
-- =====================================================================

-- ---------- hr_candidates: new statuses + training start date ----------
-- interview_date already exists (0001_init.sql) and is reused for the
-- "Interviewing requires a date" requirement — only training_start_date
-- is new.
alter table hr_candidates drop constraint if exists hr_candidates_status_check;
alter table hr_candidates add constraint hr_candidates_status_check
  check (status in ('applied', 'interviewing', 'selected', 'training', 'on_hold', 'hired', 'rejected'));
alter table hr_candidates add column if not exists training_start_date date;

-- ---------- Staff Needed per Position + Branch (manually entered by HR) ----------
create table if not exists hr_staffing_targets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  position      text not null,
  branch        text not null,
  staff_needed  integer not null default 0,
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now(),
  unique (company_id, position, branch)
);
create index if not exists idx_hr_staffing_targets_company on hr_staffing_targets(company_id);

create or replace function hr_staffing_targets_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  if new.updated_by is null then
    new.updated_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_staffing_targets_insert on hr_staffing_targets;
create trigger trg_hr_staffing_targets_insert before insert on hr_staffing_targets
  for each row execute function hr_staffing_targets_stamp();

drop trigger if exists trg_hr_staffing_targets_update on hr_staffing_targets;
create trigger trg_hr_staffing_targets_update before update on hr_staffing_targets
  for each row execute function hr_staffing_targets_stamp();

-- ---------- Append-only candidate status history ----------
-- One row per *actual* status transition (never per no-op re-save — see
-- hr_update_candidate_status below). position/branch are snapshotted at
-- the time of the transition so a later edit to the candidate's
-- position/branch doesn't rewrite past months' EOM totals.
create table if not exists hr_candidate_status_history (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  candidate_id    uuid not null references hr_candidates(id) on delete cascade,
  from_status     text,
  to_status       text not null,
  position        text,
  branch          text,
  effective_date  date,
  changed_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_hr_status_history_report on hr_candidate_status_history(company_id, position, branch, to_status, created_at);
create index if not exists idx_hr_status_history_candidate on hr_candidate_status_history(candidate_id, created_at);

-- ---------- CV forwards (for the "CVs Sent to BM/PM" report column) ----------
-- One row per "Forward CV" action from the Hiring tab — counted per the
-- CANDIDATE's Position+Branch (not the recipient's), per the spec: a CV
-- forwarded for an Asheville candidate counts on Asheville's row even if
-- sent to a manager based elsewhere.
create table if not exists hr_candidate_cv_forwards (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  candidate_id  uuid not null references hr_candidates(id) on delete cascade,
  position      text,
  branch        text,
  recipient_id  uuid references profiles(id),
  forwarded_by  uuid references profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_hr_cv_forwards_report on hr_candidate_cv_forwards(company_id, position, branch, created_at);

create or replace function hr_cv_forwards_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.forwarded_by is null then
    new.forwarded_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_cv_forwards_stamp on hr_candidate_cv_forwards;
create trigger trg_hr_cv_forwards_stamp before insert on hr_candidate_cv_forwards
  for each row execute function hr_cv_forwards_stamp();

-- ---------- RLS: standard tenant pattern for all three new tables ----------
do $$
declare t text;
begin
  foreach t in array array['hr_staffing_targets', 'hr_candidate_status_history', 'hr_candidate_cv_forwards'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);

    execute format('drop policy if exists %1$s_select on %1$I;', t);
    execute format($f$
      create policy %1$s_select on %1$I
      for select using (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_insert on %1$I;', t);
    execute format($f$
      create policy %1$s_insert on %1$I
      for insert with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_update on %1$I;', t);
    execute format($f$
      create policy %1$s_update on %1$I
      for update using (company_id = auth_company_id() or is_superadmin())
                  with check (company_id = auth_company_id() or is_superadmin());
    $f$, t);

    execute format('drop policy if exists %1$s_delete on %1$I;', t);
    execute format($f$
      create policy %1$s_delete on %1$I
      for delete using (company_id = auth_company_id() or is_superadmin());
    $f$, t);
  end loop;
end $$;

-- ---------- Log the initial status when a candidate is first created ----------
create or replace function hr_candidates_log_initial_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into hr_candidate_status_history
    (company_id, candidate_id, from_status, to_status, position, branch, effective_date, changed_by)
  values
    (new.company_id, new.id, null, new.status, new.position, new.branch, null, new.created_by);
  return new;
end;
$$;

drop trigger if exists trg_hr_candidates_log_initial_status on hr_candidates;
create trigger trg_hr_candidates_log_initial_status after insert on hr_candidates
  for each row execute function hr_candidates_log_initial_status();

-- ---------- Atomic status transition: history + Staff Needed +/-1 together ----------
-- SECURITY DEFINER (so it can write hr_candidate_status_history and adjust
-- hr_staffing_targets in one transaction) — manually re-checks the caller's
-- company against the candidate's, since a SECURITY DEFINER function
-- bypasses RLS entirely rather than relying on it.
create or replace function hr_update_candidate_status(
  p_candidate_id uuid,
  p_new_status text,
  p_effective_date date default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_old_status text;
  v_position text;
  v_branch text;
begin
  if p_new_status not in ('applied', 'interviewing', 'selected', 'training', 'on_hold', 'hired', 'rejected') then
    raise exception 'Invalid status: %', p_new_status;
  end if;

  select company_id, status, position, branch
  into v_company_id, v_old_status, v_position, v_branch
  from hr_candidates
  where id = p_candidate_id
  for update;

  if v_company_id is null then
    raise exception 'Candidate not found';
  end if;
  if v_company_id <> auth_company_id() and not is_superadmin() then
    raise exception 'Not authorized for this candidate';
  end if;

  -- Same status re-saved (e.g. rescheduling without changing the status
  -- itself) — never log a duplicate transition or double-apply the Staff
  -- Needed effect, just let the date update through if one was given.
  if v_old_status = p_new_status then
    if p_new_status = 'interviewing' and p_effective_date is not null then
      update hr_candidates set interview_date = p_effective_date where id = p_candidate_id;
    elsif p_new_status = 'training' and p_effective_date is not null then
      update hr_candidates set training_start_date = p_effective_date where id = p_candidate_id;
    end if;
    return;
  end if;

  update hr_candidates
  set status = p_new_status,
      interview_date = case when p_new_status = 'interviewing' then coalesce(p_effective_date, interview_date) else interview_date end,
      training_start_date = case when p_new_status = 'training' then coalesce(p_effective_date, training_start_date) else training_start_date end
  where id = p_candidate_id;

  insert into hr_candidate_status_history
    (company_id, candidate_id, from_status, to_status, position, branch, effective_date, changed_by)
  values
    (v_company_id, p_candidate_id, v_old_status, p_new_status, v_position, v_branch, p_effective_date, auth_profile_id());

  -- Staff Needed only moves for a genuine hire / reversed hire — On Hold
  -- and every other status are explicitly no-ops here.
  if p_new_status = 'hired' and v_old_status <> 'hired' then
    update hr_staffing_targets
    set staff_needed = staff_needed - 1
    where company_id = v_company_id and position = v_position and branch = v_branch;
  elsif v_old_status = 'hired' and p_new_status <> 'hired' then
    update hr_staffing_targets
    set staff_needed = staff_needed + 1
    where company_id = v_company_id and position = v_position and branch = v_branch;
  end if;
end;
$$;

grant execute on function hr_update_candidate_status(uuid, text, date) to authenticated;
