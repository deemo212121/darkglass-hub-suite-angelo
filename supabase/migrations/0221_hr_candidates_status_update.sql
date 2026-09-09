-- =====================================================================
-- Candidate pipeline status changes:
--   - Adds "phone_screening" (between Applied and Interviewing),
--     "withdrawn" (with its own withdrawn_date, same shape as
--     interview_date/training_start_date), and "cancelled".
--   - Removes "on_hold" (confirmed no existing hr_candidates row uses it,
--     so no data backfill needed before tightening the CHECK constraint).
--
-- Run once in the Supabase SQL Editor, after 0048_hr_hiring_reports.sql.
-- =====================================================================

alter table hr_candidates add column if not exists withdrawn_date date;

alter table hr_candidates drop constraint if exists hr_candidates_status_check;
alter table hr_candidates add constraint hr_candidates_status_check
  check (status in ('applied', 'phone_screening', 'interviewing', 'selected', 'training', 'hired', 'rejected', 'withdrawn', 'cancelled'));

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
  if p_new_status not in ('applied', 'phone_screening', 'interviewing', 'selected', 'training', 'hired', 'rejected', 'withdrawn', 'cancelled') then
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
    elsif p_new_status = 'withdrawn' and p_effective_date is not null then
      update hr_candidates set withdrawn_date = p_effective_date where id = p_candidate_id;
    end if;
    return;
  end if;

  update hr_candidates
  set status = p_new_status,
      interview_date = case when p_new_status = 'interviewing' then coalesce(p_effective_date, interview_date) else interview_date end,
      training_start_date = case when p_new_status = 'training' then coalesce(p_effective_date, training_start_date) else training_start_date end,
      withdrawn_date = case when p_new_status = 'withdrawn' then coalesce(p_effective_date, withdrawn_date) else withdrawn_date end
  where id = p_candidate_id;

  insert into hr_candidate_status_history
    (company_id, candidate_id, from_status, to_status, position, branch, effective_date, changed_by)
  values
    (v_company_id, p_candidate_id, v_old_status, p_new_status, v_position, v_branch, p_effective_date, auth_profile_id());

  -- Staff Needed only moves for a genuine hire / reversed hire — every
  -- other status (including the new ones) is explicitly a no-op here.
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
