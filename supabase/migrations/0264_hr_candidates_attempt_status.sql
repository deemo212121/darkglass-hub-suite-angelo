-- =====================================================================
-- 0264 — Add "attempt" candidate status
--
-- New pipeline stage between "applied" and "interviewing": HR attempted to
-- contact the candidate (call/text) but hasn't reached them yet. Plain
-- status value, no new date field — same shape as "applied"/"cancelled",
-- which already have no effective-date handling in hr_update_candidate_status.
--
-- Run once in the Supabase SQL Editor, after 0263.
-- =====================================================================

alter table hr_candidates drop constraint if exists hr_candidates_status_check;
alter table hr_candidates add constraint hr_candidates_status_check
  check (status in ('applied', 'attempt', 'phone_screening', 'interviewing', 'selected', 'training', 'hired', 'rejected', 'withdrawn', 'cancelled'));

create or replace function hr_update_candidate_status(
  p_candidate_id uuid,
  p_new_status text,
  p_effective_date date default null,
  p_training_end_date date default null,
  p_interview_time text default null,
  p_interview_timezone text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company_id uuid;
  v_old_status text;
  v_position text;
  v_branch text;
begin
  if p_new_status not in ('applied', 'attempt', 'phone_screening', 'interviewing', 'selected', 'training', 'hired', 'rejected', 'withdrawn', 'cancelled') then
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
  -- Needed effect, just let the date/time/zone update through if given.
  if v_old_status = p_new_status then
    if p_new_status = 'interviewing' and (p_effective_date is not null or p_interview_time is not null or p_interview_timezone is not null) then
      update hr_candidates
      set interview_date = coalesce(p_effective_date, interview_date),
          interview_time = p_interview_time,
          interview_timezone = p_interview_timezone
      where id = p_candidate_id;
    elsif p_new_status = 'training' and (p_effective_date is not null or p_training_end_date is not null) then
      update hr_candidates
      set training_start_date = coalesce(p_effective_date, training_start_date),
          training_end_date = p_training_end_date
      where id = p_candidate_id;
    elsif p_new_status = 'withdrawn' and p_effective_date is not null then
      update hr_candidates set withdrawn_date = p_effective_date where id = p_candidate_id;
    elsif p_new_status = 'hired' and p_effective_date is not null then
      update hr_candidates set start_date = p_effective_date where id = p_candidate_id;
    end if;
    return;
  end if;

  update hr_candidates
  set status = p_new_status,
      interview_date = case when p_new_status = 'interviewing' then coalesce(p_effective_date, interview_date) else interview_date end,
      interview_time = case when p_new_status = 'interviewing' then p_interview_time else interview_time end,
      interview_timezone = case when p_new_status = 'interviewing' then p_interview_timezone else interview_timezone end,
      training_start_date = case when p_new_status = 'training' then coalesce(p_effective_date, training_start_date) else training_start_date end,
      training_end_date = case when p_new_status = 'training' then p_training_end_date else training_end_date end,
      withdrawn_date = case when p_new_status = 'withdrawn' then coalesce(p_effective_date, withdrawn_date) else withdrawn_date end,
      start_date = case when p_new_status = 'hired' then coalesce(p_effective_date, start_date) else start_date end
  where id = p_candidate_id;

  insert into hr_candidate_status_history
    (company_id, candidate_id, from_status, to_status, position, branch, effective_date, changed_by)
  values
    (v_company_id, p_candidate_id, v_old_status, p_new_status, v_position, v_branch, p_effective_date, auth_profile_id());

  -- Staff Needed only moves for a genuine hire / reversed hire — every
  -- other status (including "attempt") is explicitly a no-op here.
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

grant execute on function hr_update_candidate_status(uuid, text, date, date, text, text) to authenticated;
