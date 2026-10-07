-- =====================================================================
-- 0356 — CSR Coaching Log (CSR module → Coaching Log).
--
-- One row per coaching session, mirroring the paper "CSR Coaching Log":
--   header + I. Summary, III. Coaching Discussion, V. TL's Action Plan
--     → written by the coach side (CSR Team Leader / CSR Manager / Admin /
--       Super Admin), never by the person being coached;
--   II. CSR's Explanation, IV. CSR's Action Plan
--     → written only by the person being coached (the "target");
--   VI. Acknowledgement → the target signs first (all five sections must be
--       filled in), then the person who created the log signs.
-- Once the target has signed, the content is frozen; once both have
-- signed, the whole log is locked (view only).
--
-- Deleting only stamps deleted_at/deleted_by — the row stays, so it can be
-- restored. Every create / edit / sign / delete / restore is written to
-- csr_coaching_log_events by trigger (who + when), so it can't be skipped.
--
-- Access:
--   read + write : ADMIN, SUPERADMIN, CSR_MANAGER, CSR_TEAM_LEADER
--   read only    : HR, SENIOR_MANAGER
--   the target   : their own logs only (fill II/IV, sign)
--
-- Also adds HR to the CSR module's whole-module access list for companies
-- that have one (HR otherwise can't open anything under CSR). Adds rows
-- only — nothing existing is changed or removed.
--
-- Run once in the Supabase SQL Editor, after 0355.
-- =====================================================================

create or replace function csr_coaching_caller_has_role(p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (
        upper(role) = any(p_roles)
        or exists (select 1 from unnest(coalesce(extra_roles, '{}')) r where upper(r) = any(p_roles))
      )
  );
$$;

create or replace function csr_coaching_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'CSR_TEAM_LEADER']);
$$;

create or replace function csr_coaching_can_read_all()
returns boolean language sql stable security definer set search_path = public as $$
  select csr_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'CSR_MANAGER', 'CSR_TEAM_LEADER', 'HR', 'SENIOR_MANAGER']);
$$;

create table if not exists csr_coaching_logs (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references companies(id) on delete cascade,
  csr_profile_id          uuid not null references profiles(id) on delete cascade,
  csr_name                text not null,
  team_leader_profile_id  uuid references profiles(id) on delete set null,
  team_leader_name        text,
  ticket_number           text not null default '',
  team                    text not null default '',
  coaching_date           date not null default current_date,
  summary                 text not null default '',
  csr_explanation         text not null default '',
  coaching_discussion     text not null default '',
  csr_action_plan         text not null default '',
  tl_action_plan          text not null default '',
  csr_signature           text,
  csr_signed_name         text,
  csr_signed_at           timestamptz,
  creator_signature       text,
  creator_signed_name     text,
  creator_signed_at       timestamptz,
  created_by              uuid references profiles(id) on delete set null,
  created_by_name         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  deleted_by              uuid references profiles(id) on delete set null,
  deleted_by_name         text
);

create index if not exists idx_csr_coaching_logs_company on csr_coaching_logs(company_id, coaching_date desc);
create index if not exists idx_csr_coaching_logs_csr on csr_coaching_logs(csr_profile_id);

create table if not exists csr_coaching_log_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  log_id      uuid not null references csr_coaching_logs(id) on delete cascade,
  action      text not null,  -- created | edited | csr_signed | creator_signed | deleted | restored
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_csr_coaching_log_events_log on csr_coaching_log_events(log_id, created_at desc);
create index if not exists idx_csr_coaching_log_events_company on csr_coaching_log_events(company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Insert: stamp company/creator, no signatures or deletion on create.
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

drop trigger if exists trg_csr_coaching_logs_before_insert on csr_coaching_logs;
create trigger trg_csr_coaching_logs_before_insert
  before insert on csr_coaching_logs
  for each row execute function csr_coaching_logs_before_insert();

-- ---------------------------------------------------------------------
-- Update: who may change what, signing order, and the lock.
-- ---------------------------------------------------------------------
create or replace function csr_coaching_logs_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_name text := (select display_name from profiles where id = v_me);
  v_writer boolean := csr_coaching_can_write();
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
      raise exception 'Only a CSR Team Leader, CSR Manager or Admin can delete or restore a coaching log.';
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

drop trigger if exists trg_csr_coaching_logs_before_update on csr_coaching_logs;
create trigger trg_csr_coaching_logs_before_update
  before update on csr_coaching_logs
  for each row execute function csr_coaching_logs_before_update();

-- ---------------------------------------------------------------------
-- History: one event per create / edit / sign / delete / restore.
-- ---------------------------------------------------------------------
create or replace function csr_coaching_logs_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_name text := (select display_name from profiles where id = v_me);
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_action := 'deleted';
  elsif new.deleted_at is null and old.deleted_at is not null then
    v_action := 'restored';
  elsif new.creator_signed_at is not null and old.creator_signed_at is null then
    v_action := 'creator_signed';
  elsif new.csr_signed_at is not null and old.csr_signed_at is null then
    v_action := 'csr_signed';
  else
    v_action := 'edited';
  end if;
  insert into csr_coaching_log_events (company_id, log_id, action, actor_id, actor_name)
  values (new.company_id, new.id, v_action, v_me, v_name);
  return null;
end;
$$;

drop trigger if exists trg_csr_coaching_logs_after_write on csr_coaching_logs;
create trigger trg_csr_coaching_logs_after_write
  after insert or update on csr_coaching_logs
  for each row execute function csr_coaching_logs_after_write();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table csr_coaching_logs enable row level security;
alter table csr_coaching_log_events enable row level security;

drop policy if exists csr_coaching_logs_select on csr_coaching_logs;
create policy csr_coaching_logs_select on csr_coaching_logs
  for select using (
    company_id = auth_company_id()
    and (csr_coaching_can_read_all() or csr_profile_id = auth_profile_id())
  );

drop policy if exists csr_coaching_logs_insert on csr_coaching_logs;
create policy csr_coaching_logs_insert on csr_coaching_logs
  for insert with check (csr_coaching_can_write());

drop policy if exists csr_coaching_logs_update on csr_coaching_logs;
create policy csr_coaching_logs_update on csr_coaching_logs
  for update using (
    company_id = auth_company_id()
    and (csr_coaching_can_write() or csr_profile_id = auth_profile_id())
  )
  with check (company_id = auth_company_id());

-- No delete policy: rows are only ever soft-deleted (deleted_at).

drop policy if exists csr_coaching_log_events_select on csr_coaching_log_events;
create policy csr_coaching_log_events_select on csr_coaching_log_events
  for select using (company_id = auth_company_id() and csr_coaching_can_read_all());

-- ---------------------------------------------------------------------
-- HR into the CSR module's whole-module gate (where one is configured).
-- ---------------------------------------------------------------------
insert into module_role_gate_overrides (company_id, module_slug, submodule_slug, role)
select distinct company_id, 'csr', '__module_access__', 'HR'
from module_role_gate_overrides
where module_slug = 'csr' and submodule_slug = '__module_access__'
on conflict (company_id, module_slug, submodule_slug, role) do nothing;
