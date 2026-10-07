-- =====================================================================
-- 0358 — Coaching Log: whoever creates the log is the coach.
--
-- The form now only asks who the log is for; the creator is the coach and
-- fills the "Team Leader" line (so a CSR Manager coaching a TL shows as
-- that TL's coach). Set on create and can't be changed afterwards.
--
-- Function/trigger definitions only — no data is changed.
-- Run once in the Supabase SQL Editor, after 0357.
-- =====================================================================

create or replace function csr_coaching_logs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
begin
  new.company_id := auth_company_id();
  new.created_by := v_me;
  new.created_by_name := (select display_name from profiles where id = v_me);
  new.team_leader_profile_id := v_me;
  new.team_leader_name := new.created_by_name;
  if new.csr_profile_id = v_me then
    raise exception 'You can''t create a coaching log for yourself.';
  end if;
  if not csr_coaching_is_manager() then
    if csr_coaching_profile_is_tl(new.csr_profile_id) then
      raise exception 'Only a CSR Manager or Admin can create a coaching log for a Team Leader.';
    end if;
    if not csr_coaching_is_my_team_agent(new.csr_profile_id) then
      raise exception 'You can only create coaching logs for agents on your own team.';
    end if;
  end if;
  new.csr_explanation := '';
  new.csr_action_plan := '';
  new.csr_signature := null; new.csr_signed_name := null; new.csr_signed_at := null;
  new.creator_signature := null; new.creator_signed_name := null; new.creator_signed_at := null;
  new.deleted_at := null; new.deleted_by := null; new.deleted_by_name := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create or replace function csr_coaching_logs_pin_coach()
returns trigger language plpgsql as $$
begin
  new.team_leader_profile_id := old.team_leader_profile_id;
  new.team_leader_name := old.team_leader_name;
  return new;
end;
$$;

drop trigger if exists trg_csr_coaching_logs_pin_coach on csr_coaching_logs;
create trigger trg_csr_coaching_logs_pin_coach
  before update on csr_coaching_logs
  for each row execute function csr_coaching_logs_pin_coach();
