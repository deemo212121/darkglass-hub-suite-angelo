-- =====================================================================
-- 0043 — CSR Agent Notes: two-stage approval (department Manager, then HR)
--
-- Ported from upstream (janeyyy16/usapp)'s
-- 0031_csr_agent_notes_manager_stage.sql, renumbered to 0043 (see
-- 0040_csr_agent_notes.sql for why).
--
-- The review workflow (0041) was single-stage: anyone in a reviewer role
-- (CSR Manager, Manager, Admin, Superadmin, HR) could unilaterally approve
-- or reject a submission. This adds a real chain of command matching how
-- it actually works, e.g. for CSR staff: Team Leader submits -> CSR
-- Manager reviews first -> HR makes the final call.
--
-- New flow:
--   pending          -> a department-level manager decides:
--                         - approve  -> manager_approved (goes to HR)
--                         - reject   -> rejected (terminal — the direct
--                           manager already found it invalid, HR doesn't
--                           need to re-review it)
--   manager_approved -> HR makes the final call:
--                         - approve  -> approved (now counts toward the
--                           employee's official tally, same rule as before)
--                         - reject   -> rejected
--
-- reviewed_by/reviewed_at now specifically mean "who made the terminal
-- decision" (whichever stage that happened at); manager_reviewed_by/at is
-- new and always records the department manager's stage-1 sign-off when
-- there was one.
--
-- Run once in the Supabase SQL Editor, after 0042.
-- =====================================================================

alter table csr_agent_notes
  drop constraint if exists csr_agent_notes_status_check;

alter table csr_agent_notes
  add constraint csr_agent_notes_status_check
  check (status in ('pending', 'manager_approved', 'approved', 'rejected'));

alter table csr_agent_notes
  add column if not exists manager_reviewed_by uuid references profiles(id),
  add column if not exists manager_reviewed_at timestamptz;

create or replace function csr_agent_notes_stamp_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'pending' and new.status = 'manager_approved' then
      new.manager_reviewed_by := auth_profile_id();
      new.manager_reviewed_at := now();
    elsif old.status = 'pending' and new.status = 'rejected' then
      -- Manager rejected directly — terminal, so also stamp it as the
      -- final decision so "who made the call" always reads from the same
      -- reviewed_by/reviewed_at pair regardless of which stage closed it.
      new.manager_reviewed_by := auth_profile_id();
      new.manager_reviewed_at := now();
      new.reviewed_by := auth_profile_id();
      new.reviewed_at := now();
    elsif old.status = 'manager_approved' and new.status in ('approved', 'rejected') then
      new.reviewed_by := auth_profile_id();
      new.reviewed_at := now();
    end if;
  end if;
  return new;
end;
$$;
