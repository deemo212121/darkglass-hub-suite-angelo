-- =====================================================================
-- 0357 — Coaching Log: Team Leaders scoped to their own team.
--
--   * CSR Manager, Admin, Super Admin: see and manage every coaching log
--     (HR and Senior Manager still see everything, read only).
--   * CSR Team Leader: sees and manages only logs for the agents on their
--     own CSR team(s) (csr_team_members — any team they belong to), plus
--     logs they created and logs about themselves (as the one coached).
--     They can only create logs for agents on their own team.
--   * Only a CSR Manager, Admin or Super Admin can create a coaching log
--     for a Team Leader; other TLs can't see a TL's coaching logs.
--
-- Policies and functions only — no data is changed.
-- Run once in the Supabase SQL Editor, after 0356.
-- =====================================================================

create or replace function csr_coaching_is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'CSR_MANAGER']);
$$;

create or replace function csr_coaching_is_full_reader()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'HR', 'SENIOR_MANAGER']);
$$;

create or replace function csr_coaching_is_tl()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['CSR_TEAM_LEADER']);
$$;

-- Does this profile hold the CSR Team Leader role (primary or extra)?
create or replace function csr_coaching_profile_is_tl(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = p_profile
      and (upper(role) = 'CSR_TEAM_LEADER' or exists (select 1 from unnest(coalesce(extra_roles, '{}')) r where upper(r) = 'CSR_TEAM_LEADER'))
  );
$$;

-- Is this profile an agent (not a TL) on one of the caller's CSR teams?
create or replace function csr_coaching_is_my_team_agent(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile is distinct from auth_profile_id()
    and not csr_coaching_profile_is_tl(p_profile)
    and exists (
      select 1
      from csr_team_members theirs
      join csr_team_members mine on mine.team_id = theirs.team_id
      where theirs.profile_id = p_profile
        and mine.profile_id = auth_profile_id()
    );
$$;

-- Coach-side access to one log: edit I/III/V and the header, delete, restore.
create or replace function csr_coaching_can_manage(p_csr uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_is_manager()
    or (
      csr_coaching_is_tl()
      and p_csr is distinct from auth_profile_id()
      and (p_created_by = auth_profile_id() or csr_coaching_is_my_team_agent(p_csr))
    );
$$;

create or replace function csr_coaching_can_see(p_csr uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_is_full_reader()
    or p_csr = auth_profile_id()
    or csr_coaching_can_manage(p_csr, p_created_by);
$$;

-- ---------------------------------------------------------------------
-- Insert: who may create a log for whom.
-- ---------------------------------------------------------------------
create or replace function csr_coaching_logs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
begin
  new.company_id := auth_company_id();
  new.created_by := v_me;
  new.created_by_name := (select display_name from profiles where id = v_me);
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

-- ---------------------------------------------------------------------
-- Update: same rules as 0356, with coach-side access now per log.
-- ---------------------------------------------------------------------
create or replace function csr_coaching_logs_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_name text := (select display_name from profiles where id = v_me);
  v_writer boolean := csr_coaching_can_manage(old.csr_profile_id, old.created_by);
  v_target boolean := (v_me is not null and v_me = old.csr_profile_id);
  v_header_changed boolean;
  v_coach_changed boolean;
  v_csr_changed boolean;
begin
  -- Fixed for the life of the row.
  new.id := old.id;
  new.company_id := old.company_id;
  new.csr_profile_id := old.csr_profile_id;
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;
  new.created_at := old.created_at;

  -- Delete / restore (writers only). Nothing else may change in the same save.
  if new.deleted_at is distinct from old.deleted_at then
    if not v_writer then
      raise exception 'You can''t delete or restore this coaching log.';
    end if;
    if new.deleted_at is not null then
      new.deleted_at := now(); new.deleted_by := v_me; new.deleted_by_name := v_name;
    else
      new.deleted_by := null; new.deleted_by_name := null;
    end if;
    new.csr_name := old.csr_name; new.team_leader_profile_id := old.team_leader_profile_id; new.team_leader_name := old.team_leader_name;
    new.ticket_number := old.ticket_number; new.team := old.team; new.coaching_date := old.coaching_date;
    new.summary := old.summary; new.csr_explanation := old.csr_explanation; new.coaching_discussion := old.coaching_discussion;
    new.csr_action_plan := old.csr_action_plan; new.tl_action_plan := old.tl_action_plan;
    new.csr_signature := old.csr_signature; new.csr_signed_name := old.csr_signed_name; new.csr_signed_at := old.csr_signed_at;
    new.creator_signature := old.creator_signature; new.creator_signed_name := old.creator_signed_name; new.creator_signed_at := old.creator_signed_at;
    new.updated_at := old.updated_at;
    return new;
  end if;
  new.deleted_by := old.deleted_by;
  new.deleted_by_name := old.deleted_by_name;
  if old.deleted_at is not null then
    raise exception 'This coaching log is deleted — restore it first.';
  end if;

  if old.csr_signed_at is not null and old.creator_signed_at is not null then
    raise exception 'This coaching log is signed by both and locked.';
  end if;

  v_header_changed := (new.csr_name, new.team_leader_profile_id, new.team_leader_name, new.ticket_number, new.team, new.coaching_date)
    is distinct from (old.csr_name, old.team_leader_profile_id, old.team_leader_name, old.ticket_number, old.team, old.coaching_date);
  v_coach_changed := (new.summary, new.coaching_discussion, new.tl_action_plan)
    is distinct from (old.summary, old.coaching_discussion, old.tl_action_plan);
  v_csr_changed := (new.csr_explanation, new.csr_action_plan)
    is distinct from (old.csr_explanation, old.csr_action_plan);

  if old.csr_signed_at is not null and (v_header_changed or v_coach_changed or v_csr_changed) then
    raise exception 'The CSR has already signed — the log can''t be edited anymore.';
  end if;
  if (v_header_changed or v_coach_changed) and (not v_writer or v_target) then
    raise exception 'Only the coach side can edit the header and sections I, III and V.';
  end if;
  if v_csr_changed and not v_target then
    raise exception 'Only the person being coached can write sections II and IV.';
  end if;

  -- 1st signature: the person being coached, once every section is filled in.
  if (new.csr_signature, new.csr_signed_name, new.csr_signed_at) is distinct from (old.csr_signature, old.csr_signed_name, old.csr_signed_at) then
    if old.csr_signed_at is not null then
      raise exception 'The CSR signature can''t be changed.';
    end if;
    if not v_target then
      raise exception 'Only the person being coached can sign first.';
    end if;
    if coalesce(new.csr_signature, '') = '' then
      raise exception 'A signature is required.';
    end if;
    if btrim(new.summary) = '' or btrim(new.csr_explanation) = '' or btrim(new.coaching_discussion) = ''
       or btrim(new.csr_action_plan) = '' or btrim(new.tl_action_plan) = '' then
      raise exception 'All five sections must be filled in before signing.';
    end if;
    new.csr_signed_at := now();
    new.csr_signed_name := coalesce(nullif(btrim(new.csr_signed_name), ''), v_name);
  end if;

  -- 2nd signature: whoever created the log, after the CSR.
  if (new.creator_signature, new.creator_signed_name, new.creator_signed_at) is distinct from (old.creator_signature, old.creator_signed_name, old.creator_signed_at) then
    if old.creator_signed_at is not null then
      raise exception 'This signature can''t be changed.';
    end if;
    if v_me is null or v_me is distinct from old.created_by then
      raise exception 'Only the person who created this coaching log can sign second.';
    end if;
    if old.csr_signed_at is null then
      raise exception 'The CSR signs first.';
    end if;
    if coalesce(new.creator_signature, '') = '' then
      raise exception 'A signature is required.';
    end if;
    new.creator_signed_at := now();
    new.creator_signed_name := coalesce(nullif(btrim(new.creator_signed_name), ''), v_name);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
drop policy if exists csr_coaching_logs_select on csr_coaching_logs;
create policy csr_coaching_logs_select on csr_coaching_logs
  for select using (
    company_id = auth_company_id()
    and csr_coaching_can_see(csr_profile_id, created_by)
  );

drop policy if exists csr_coaching_logs_insert on csr_coaching_logs;
create policy csr_coaching_logs_insert on csr_coaching_logs
  for insert with check (csr_coaching_is_manager() or csr_coaching_is_tl());

drop policy if exists csr_coaching_logs_update on csr_coaching_logs;
create policy csr_coaching_logs_update on csr_coaching_logs
  for update using (
    company_id = auth_company_id()
    and (csr_coaching_can_manage(csr_profile_id, created_by) or csr_profile_id = auth_profile_id())
  )
  with check (company_id = auth_company_id());

drop policy if exists csr_coaching_log_events_select on csr_coaching_log_events;
create policy csr_coaching_log_events_select on csr_coaching_log_events
  for select using (
    company_id = auth_company_id()
    and exists (
      select 1 from csr_coaching_logs l
      where l.id = log_id
        and (csr_coaching_is_full_reader() or csr_coaching_can_manage(l.csr_profile_id, l.created_by))
    )
  );
