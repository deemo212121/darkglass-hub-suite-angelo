-- =====================================================================
-- 0384 — PTO / leave requests: each department approves only its own
-- people at the Manager step (same rule Time Corrections got in 0366).
--
-- pto_requests still used chain_can_approve (0332), which ranks Branch
-- Managers and every Parts role on one shared "branch" level — so a Senior
-- Branch Manager (tech side) could approve a Parts Team Leader's leave
-- (e.g. Matt Simmons approving Amanda Simmons, Columbus Parts), and Parts
-- staff could approve technicians'. The Manager step of a PTO request now
-- uses chain_can_approve_correction (0366):
--
--   Parts Manager's request              -> HR, Admin, SuperAdmin only
--   Parts / Parts Team Leader / Parts Order -> their branch's Parts Manager,
--                                              or HR, Admin, SuperAdmin
--   Technician's request                 -> BM same branch, owning SBM,
--                                              top level (no Parts roles)
--   Everyone else (incl. the Philippines chain) -> unchanged
--
-- HR and Accounting stages are unchanged (any 2 of the 3 stages decide a
-- leave request — 0335), so no request is left without a way through.
--
-- Function and trigger changes only — no data is changed.
-- Run once in the Supabase SQL Editor, after 0383.
-- =====================================================================

create or replace function chain_enforce_pto_manager_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth_profile_id();
  allowed boolean;
  is_staff boolean;
begin
  if me is null then return new; end if; -- server / service-role write
  if tg_op = 'UPDATE' and new.manager_status is not distinct from old.manager_status then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.manager_status, 'pending') = 'pending' then return new; end if;

  allowed := chain_can_approve_correction(me, new.profile_id);
  if allowed is null then return new; end if; -- not governed — existing rules
  if allowed then return new; end if;

  -- HR / Admin may still reset a step back to pending, or file a request
  -- already approved on someone's behalf (HR Calendar), as before.
  is_staff := is_hr() or is_admin() or is_company_superadmin() or is_superadmin();
  if is_staff and (new.manager_status = 'pending' or tg_op = 'INSERT') then return new; end if;

  raise exception 'Approval chain: you are not allowed to approve or reject this employee''s leave request at the Manager step — it belongs to another department.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_chain_manager_stage on pto_requests;
create trigger trg_chain_manager_stage before insert or update on pto_requests
  for each row execute function chain_enforce_pto_manager_stage();
