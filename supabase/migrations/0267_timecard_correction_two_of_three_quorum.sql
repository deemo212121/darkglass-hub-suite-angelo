-- =====================================================================
-- 0267_timecard_correction_two_of_three_quorum.sql
--
-- Timecard corrections (0098_timecard_correction_two_stage_approval.sql)
-- required the manager to approve first, then either HR or Accounting to
-- give the final approval — a request stalled completely if the direct
-- manager was unavailable, even with both HR and Accounting ready to act.
--
-- New rule (the user's explicit call): Manager, HR, and Accounting are all
-- open to review from the moment a correction is submitted — none of the
-- three is gated behind another going first (see canReviewCorrectionStage
-- in timecardCorrections.ts, updated alongside this migration to drop the
-- old "HR/Accounting only after manager approves" check). Overall approval
-- now needs ANY 2 of the 3 stages to approve, not specifically the manager.
-- Any single stage rejecting still rejects the whole request, unchanged.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create or replace function sync_timecard_correction_overall_status()
returns trigger language plpgsql as $$
declare
  approved_count int;
begin
  if new.manager_status = 'rejected' or new.hr_status = 'rejected' or new.accounting_status = 'rejected' then
    new.status := 'rejected';
    return new;
  end if;

  approved_count :=
    (case when new.manager_status = 'approved' then 1 else 0 end) +
    (case when new.hr_status = 'approved' then 1 else 0 end) +
    (case when new.accounting_status = 'approved' then 1 else 0 end);

  if approved_count >= 2 then
    new.status := 'approved';
  else
    new.status := 'pending';
  end if;
  return new;
end;
$$;

-- The trigger itself (trg_timecard_correction_a_overall_status, created in
-- 0098) already points at this function by name — replacing the function
-- body above is sufficient, no need to touch the trigger definition.
