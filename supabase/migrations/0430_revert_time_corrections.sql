-- =====================================================================
-- 0430 — Revert for Time Corrections, and a Ticket Dispute fix
--
-- Time Corrections get the same Revert as Time-Off (0429): one step at a
-- time, only by the person who made that decision or a Super Admin, with a
-- required note, recorded in decision_reverts. The existing triggers
-- recompute the overall status (any two of three approve). Putting the
-- timecard back stays in the app (decisionReverts.ts), the same code the
-- old Undo used.
--
-- Ticket Dispute fix: an approved dispute can be rejected afterward from
-- Exception Reports, which leaves the claimed times on the ticket. Reverting
-- that rejection used to throw away the saved old times, so a later Revert
-- of the re-approval couldn't restore them. They're now only cleared once
-- they've actually been put back.
--
-- No table or data changes, only these two functions. Safe to rerun.
-- Run once in the Supabase SQL Editor, after 0429.
-- =====================================================================

-- Returns { status_before, status_after }, which the app uses to decide
-- whether the timecard needs putting back.
create or replace function revert_correction_stage(p_id uuid, p_stage text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
  v_request timecard_corrections%rowtype;
  v_status text;
  v_decided_by uuid;
  v_previous_note text;
  v_stage_label text;
  v_line text;
  v_review_note text;
  v_after text;
begin
  select * into v_caller from decision_revert_caller();
  if v_caller.profile_id is null then
    raise exception 'Profile not found';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'A note is required to revert a decision.';
  end if;
  if p_stage not in ('manager', 'hr', 'accounting') then
    raise exception 'Unknown step';
  end if;

  select * into v_request from timecard_corrections r where r.id = p_id and r.company_id = v_caller.company_id for update;
  if not found then
    raise exception 'That correction could not be found.';
  end if;

  if p_stage = 'manager' then
    v_status := v_request.manager_status; v_decided_by := v_request.manager_reviewed_by; v_previous_note := v_request.manager_note; v_stage_label := 'Manager';
  elsif p_stage = 'hr' then
    v_status := v_request.hr_status; v_decided_by := v_request.hr_reviewed_by; v_previous_note := v_request.hr_note; v_stage_label := 'HR';
  else
    v_status := v_request.accounting_status; v_decided_by := v_request.accounting_reviewed_by; v_previous_note := v_request.accounting_note; v_stage_label := 'Accounting';
  end if;

  if v_status not in ('approved', 'rejected') then
    raise exception 'That step has no decision to revert.';
  end if;
  if not v_caller.is_super and v_decided_by is distinct from v_caller.profile_id then
    raise exception 'Only the person who made this decision, or a Super Admin, can revert it.';
  end if;

  v_line := v_stage_label || case when v_status = 'approved' then ' approval' else ' rejection' end
    || ' reverted by ' || v_caller.name || '. Reason: ' || btrim(p_note);
  v_review_note := case when coalesce(v_request.review_note, '') = '' then v_line else v_request.review_note || E'\n' || v_line end;

  if p_stage = 'manager' then
    update timecard_corrections r
    set manager_status = 'pending', manager_reviewed_by = null, manager_reviewed_at = null, manager_note = null,
        manager_comments = null, manager_signature_url = null, manager_signature_name = null, manager_signed_at = null,
        review_note = v_review_note
    where r.id = p_id
    returning r.status into v_after;
  elsif p_stage = 'hr' then
    update timecard_corrections r
    set hr_status = 'pending', hr_reviewed_by = null, hr_reviewed_at = null, hr_note = null, review_note = v_review_note
    where r.id = p_id
    returning r.status into v_after;
  else
    update timecard_corrections r
    set accounting_status = 'pending', accounting_reviewed_by = null, accounting_reviewed_at = null, accounting_note = null,
        accounting_signature_url = null, accounting_signature_name = null, accounting_signed_at = null,
        review_note = v_review_note
    where r.id = p_id
    returning r.status into v_after;
  end if;

  insert into decision_reverts (
    company_id, record_type, record_id, stage, subject_profile_id, subject_name, label,
    previous_status, previous_decided_by, previous_decided_by_name, previous_note,
    reverted_by, reverted_by_name, note, details
  ) values (
    v_request.company_id, 'timecard_correction', p_id, p_stage, v_request.profile_id,
    (select coalesce(s.display_name, s.username, s.email) from profiles s where s.id = v_request.profile_id),
    'Time correction ' || v_request.work_date::text,
    v_status, v_decided_by,
    (select coalesce(d.display_name, d.username, d.email) from profiles d where d.id = v_decided_by),
    v_previous_note, v_caller.profile_id, v_caller.name, btrim(p_note),
    jsonb_build_object('status_before', v_request.status, 'status_after', v_after)
  );

  return jsonb_build_object('status_before', v_request.status, 'status_after', v_after);
end;
$$;

-- Same as 0429, except the saved old times are only cleared once they've been put back.
create or replace function revert_ticket_dispute(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
  v_request employee_requests%rowtype;
  v_restored boolean := false;
  v_line text;
begin
  select * into v_caller from decision_revert_caller();
  if v_caller.profile_id is null then
    raise exception 'Profile not found';
  end if;
  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'A note is required to revert a decision.';
  end if;

  select * into v_request from employee_requests r
  where r.id = p_id and r.company_id = v_caller.company_id and r.request_type = 'ticket_time_dispute'
  for update;
  if not found then
    raise exception 'That dispute could not be found.';
  end if;
  if v_request.status not in ('approved', 'rejected') then
    raise exception 'That dispute has no decision to revert.';
  end if;
  if not v_caller.is_super and v_request.reviewed_by is distinct from v_caller.profile_id then
    raise exception 'Only the person who made this decision, or a Super Admin, can revert it.';
  end if;

  if v_request.status = 'approved' and v_request.original_onsite_saved_at is not null and v_request.ticket_no is not null then
    update tickets t
    set onsite_arrived_at = v_request.original_onsite_arrived_at, onsite_done_at = v_request.original_onsite_done_at
    where t.company_id = v_request.company_id and t.ticket_no = v_request.ticket_no;
    v_restored := found;
  end if;

  v_line := case when v_request.status = 'approved' then 'Approval' else 'Rejection' end
    || ' reverted by ' || v_caller.name || '. Reason: ' || btrim(p_note);

  update employee_requests r
  set status = 'pending', reviewed_by = null, reviewed_at = null, review_note = v_line,
      manager_comments = null, manager_signature_url = null, manager_signature_name = null, manager_signed_at = null,
      original_onsite_arrived_at = case when v_restored then null else r.original_onsite_arrived_at end,
      original_onsite_done_at = case when v_restored then null else r.original_onsite_done_at end,
      original_onsite_saved_at = case when v_restored then null else r.original_onsite_saved_at end
  where r.id = p_id;

  insert into decision_reverts (
    company_id, record_type, record_id, subject_profile_id, subject_name, label,
    previous_status, previous_decided_by, previous_decided_by_name, previous_note,
    reverted_by, reverted_by_name, note, details
  ) values (
    v_request.company_id, 'ticket_time_dispute', p_id, v_request.profile_id,
    (select coalesce(s.display_name, s.username, s.email) from profiles s where s.id = v_request.profile_id),
    case when v_request.ticket_no is not null then 'Ticket ' || v_request.ticket_no else 'Ticket dispute' end,
    v_request.status, v_request.reviewed_by,
    (select coalesce(d.display_name, d.username, d.email) from profiles d where d.id = v_request.reviewed_by),
    v_request.review_note, v_caller.profile_id, v_caller.name, btrim(p_note),
    jsonb_build_object('ticket_no', v_request.ticket_no, 'times_restored', v_restored)
  );

  return jsonb_build_object('ticket_no', v_request.ticket_no, 'was_approved', v_request.status = 'approved', 'times_restored', v_restored);
end;
$$;

notify pgrst, 'reload schema';
