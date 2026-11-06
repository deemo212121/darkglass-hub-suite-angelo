-- =====================================================================
-- 0431 — Accounting Coaching Log (Accounting module → Coaching Log).
--
-- A copy of the CSR Coaching Log (0356–0360) for the Accounting department,
-- in its own tables so the two departments' logs never mix. The CSR tables
-- and their triggers are not touched. Two differences from the CSR form:
-- "Ticket Number" is "Issue" here, and there's no Team field.
--
-- One row per coaching session:
--   header + I. Summary, III. Coaching Discussion, V. Coach's Action Plan
--     → written by the coach side, never by the person being coached;
--   II. Accounting Staff's Explanation, IV. Accounting Staff's Action Plan
--     → written only by the person being coached;
--   VI. Acknowledgement → the person coached signs first (all five sections
--       must be filled in), then the person who created the log signs.
-- Once the person coached has signed, the content is frozen; once both have
-- signed, the whole log is locked (view only). Whoever creates a log is its
-- coach, and that can't be changed afterwards.
--
-- Deleting only stamps deleted_at/deleted_by — the row stays, so it can be
-- restored. Every create / edit / send / sign / delete / restore is written
-- to accounting_coaching_log_events by trigger (who + when), so it can't be
-- skipped.
--
-- Access (Accounting has one role, FINANCE, so no Team Leader tier and no
-- team scoping like CSR has):
--   read + write : ADMIN, SUPERADMIN, SUPERSUPERADMIN
--   read only    : HR, SENIOR_MANAGER
--   the person coached : their own logs only (fill II/IV, sign)
--
-- New tables and functions only — nothing outside them is changed.
-- Safe to rerun. Run once in the Supabase SQL Editor, after 0430.
-- =====================================================================

create or replace function accounting_coaching_caller_has_role(p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
      and (
        replace(upper(trim(role)), ' ', '_') = any(p_roles)
        or exists (select 1 from unnest(coalesce(extra_roles, '{}')) r where replace(upper(trim(r)), ' ', '_') = any(p_roles))
      )
  );
$$;

create or replace function accounting_coaching_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select accounting_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN']);
$$;

create or replace function accounting_coaching_can_read_all()
returns boolean language sql stable security definer set search_path = public as $$
  select accounting_coaching_caller_has_role(array['ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN', 'HR', 'SENIOR_MANAGER']);
$$;

create table if not exists accounting_coaching_logs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  employee_profile_id   uuid not null references profiles(id) on delete cascade,
  employee_name         text not null,
  coach_profile_id      uuid references profiles(id) on delete set null,
  coach_name            text,
  issue                 text not null default '',
  coaching_date         date not null default current_date,
  summary               text not null default '',
  employee_explanation  text not null default '',
  coaching_discussion   text not null default '',
  employee_action_plan  text not null default '',
  coach_action_plan     text not null default '',
  employee_signature    text,
  employee_signed_name  text,
  employee_signed_at    timestamptz,
  creator_signature     text,
  creator_signed_name   text,
  creator_signed_at     timestamptz,
  created_by            uuid references profiles(id) on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  deleted_by            uuid references profiles(id) on delete set null,
  deleted_by_name       text,
  sent_at               timestamptz,
  sent_by_name          text
);

-- The first draft of this file made the table with ticket_number and team, and
-- "create table if not exists" leaves an existing table as it is. This brings
-- one of those in line, and does nothing on a table made from this version.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounting_coaching_logs' and column_name = 'ticket_number'
  ) then
    alter table accounting_coaching_logs rename column ticket_number to issue;
  end if;
end;
$$;
alter table accounting_coaching_logs drop column if exists team;

create index if not exists idx_accounting_coaching_logs_company on accounting_coaching_logs(company_id, coaching_date desc);
create index if not exists idx_accounting_coaching_logs_employee on accounting_coaching_logs(employee_profile_id);

create table if not exists accounting_coaching_log_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  log_id      uuid not null references accounting_coaching_logs(id) on delete cascade,
  action      text not null,  -- created | edited | sent | employee_signed | creator_signed | deleted | restored
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_accounting_coaching_log_events_log on accounting_coaching_log_events(log_id, created_at desc);
create index if not exists idx_accounting_coaching_log_events_company on accounting_coaching_log_events(company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Insert: stamp company/creator/coach, no signatures or deletion on create.
-- ---------------------------------------------------------------------
create or replace function accounting_coaching_logs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
begin
  new.company_id := auth_company_id();
  new.created_by := v_me;
  new.created_by_name := (select display_name from profiles where id = v_me);
  new.coach_profile_id := v_me;
  new.coach_name := new.created_by_name;
  if new.employee_profile_id = v_me then
    raise exception 'You can''t create a coaching log for yourself.';
  end if;
  new.employee_explanation := '';
  new.employee_action_plan := '';
  new.employee_signature := null; new.employee_signed_name := null; new.employee_signed_at := null;
  new.creator_signature := null; new.creator_signed_name := null; new.creator_signed_at := null;
  new.deleted_at := null; new.deleted_by := null; new.deleted_by_name := null;
  new.sent_at := null; new.sent_by_name := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_accounting_coaching_logs_before_insert on accounting_coaching_logs;
create trigger trg_accounting_coaching_logs_before_insert
  before insert on accounting_coaching_logs
  for each row execute function accounting_coaching_logs_before_insert();

-- ---------------------------------------------------------------------
-- Update: who may change what, signing order, and the lock.
-- ---------------------------------------------------------------------
create or replace function accounting_coaching_logs_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_name text := (select display_name from profiles where id = v_me);
  v_writer boolean := accounting_coaching_can_write();
  v_target boolean := (v_me is not null and v_me = old.employee_profile_id);
  v_header_changed boolean;
  v_coach_changed boolean;
  v_employee_changed boolean;
begin
  -- Fixed for the life of the row.
  new.id := old.id;
  new.company_id := old.company_id;
  new.employee_profile_id := old.employee_profile_id;
  new.employee_name := old.employee_name;
  new.coach_profile_id := old.coach_profile_id;
  new.coach_name := old.coach_name;
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;
  new.created_at := old.created_at;

  -- Delete / restore (writers only). Nothing else may change in the same save.
  if new.deleted_at is distinct from old.deleted_at then
    if not v_writer or v_target then
      raise exception 'You can''t delete or restore this coaching log.';
    end if;
    if new.deleted_at is not null then
      new.deleted_at := now(); new.deleted_by := v_me; new.deleted_by_name := v_name;
    else
      new.deleted_by := null; new.deleted_by_name := null;
    end if;
    new.issue := old.issue; new.coaching_date := old.coaching_date;
    new.summary := old.summary; new.employee_explanation := old.employee_explanation; new.coaching_discussion := old.coaching_discussion;
    new.employee_action_plan := old.employee_action_plan; new.coach_action_plan := old.coach_action_plan;
    new.employee_signature := old.employee_signature; new.employee_signed_name := old.employee_signed_name; new.employee_signed_at := old.employee_signed_at;
    new.creator_signature := old.creator_signature; new.creator_signed_name := old.creator_signed_name; new.creator_signed_at := old.creator_signed_at;
    new.sent_at := old.sent_at; new.sent_by_name := old.sent_by_name;
    new.updated_at := old.updated_at;
    return new;
  end if;
  new.deleted_by := old.deleted_by;
  new.deleted_by_name := old.deleted_by_name;
  if old.deleted_at is not null then
    raise exception 'This coaching log is deleted — restore it first.';
  end if;

  if old.employee_signed_at is not null and old.creator_signed_at is not null then
    raise exception 'This coaching log is signed by both and locked.';
  end if;

  -- "Sent": stamped by the server, coach side only, never cleared.
  if new.sent_at is distinct from old.sent_at and new.sent_at is not null and v_writer and not v_target then
    new.sent_at := now();
    new.sent_by_name := v_name;
  else
    new.sent_at := old.sent_at;
    new.sent_by_name := old.sent_by_name;
  end if;

  v_header_changed := (new.issue, new.coaching_date)
    is distinct from (old.issue, old.coaching_date);
  v_coach_changed := (new.summary, new.coaching_discussion, new.coach_action_plan)
    is distinct from (old.summary, old.coaching_discussion, old.coach_action_plan);
  v_employee_changed := (new.employee_explanation, new.employee_action_plan)
    is distinct from (old.employee_explanation, old.employee_action_plan);

  if old.employee_signed_at is not null and (v_header_changed or v_coach_changed or v_employee_changed) then
    raise exception 'The person being coached has already signed — the log can''t be edited anymore.';
  end if;
  if (v_header_changed or v_coach_changed) and (not v_writer or v_target) then
    raise exception 'Only the coach side can edit the header and sections I, III and V.';
  end if;
  if v_employee_changed and not v_target then
    raise exception 'Only the person being coached can write sections II and IV.';
  end if;

  -- 1st signature: the person being coached, once every section is filled in.
  if (new.employee_signature, new.employee_signed_name, new.employee_signed_at) is distinct from (old.employee_signature, old.employee_signed_name, old.employee_signed_at) then
    if old.employee_signed_at is not null then
      raise exception 'This signature can''t be changed.';
    end if;
    if not v_target then
      raise exception 'Only the person being coached can sign first.';
    end if;
    if coalesce(new.employee_signature, '') = '' then
      raise exception 'A signature is required.';
    end if;
    if btrim(new.summary) = '' or btrim(new.employee_explanation) = '' or btrim(new.coaching_discussion) = ''
       or btrim(new.employee_action_plan) = '' or btrim(new.coach_action_plan) = '' then
      raise exception 'All five sections must be filled in before signing.';
    end if;
    new.employee_signed_at := now();
    new.employee_signed_name := coalesce(nullif(btrim(new.employee_signed_name), ''), v_name);
  end if;

  -- 2nd signature: whoever created the log, after the person being coached.
  if (new.creator_signature, new.creator_signed_name, new.creator_signed_at) is distinct from (old.creator_signature, old.creator_signed_name, old.creator_signed_at) then
    if old.creator_signed_at is not null then
      raise exception 'This signature can''t be changed.';
    end if;
    if v_me is null or v_me is distinct from old.created_by then
      raise exception 'Only the person who created this coaching log can sign second.';
    end if;
    if old.employee_signed_at is null then
      raise exception 'The person being coached signs first.';
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

drop trigger if exists trg_accounting_coaching_logs_before_update on accounting_coaching_logs;
create trigger trg_accounting_coaching_logs_before_update
  before update on accounting_coaching_logs
  for each row execute function accounting_coaching_logs_before_update();

-- ---------------------------------------------------------------------
-- History: one event per create / edit / send / sign / delete / restore.
-- ---------------------------------------------------------------------
create or replace function accounting_coaching_logs_after_write()
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
  elsif new.sent_at is distinct from old.sent_at and new.sent_at is not null then
    v_action := 'sent';
  elsif new.creator_signed_at is not null and old.creator_signed_at is null then
    v_action := 'creator_signed';
  elsif new.employee_signed_at is not null and old.employee_signed_at is null then
    v_action := 'employee_signed';
  else
    v_action := 'edited';
  end if;
  insert into accounting_coaching_log_events (company_id, log_id, action, actor_id, actor_name)
  values (new.company_id, new.id, v_action, v_me, v_name);
  return null;
end;
$$;

drop trigger if exists trg_accounting_coaching_logs_after_write on accounting_coaching_logs;
create trigger trg_accounting_coaching_logs_after_write
  after insert or update on accounting_coaching_logs
  for each row execute function accounting_coaching_logs_after_write();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table accounting_coaching_logs enable row level security;
alter table accounting_coaching_log_events enable row level security;

drop policy if exists accounting_coaching_logs_select on accounting_coaching_logs;
create policy accounting_coaching_logs_select on accounting_coaching_logs
  for select using (
    company_id = auth_company_id()
    and (accounting_coaching_can_read_all() or employee_profile_id = auth_profile_id())
  );

drop policy if exists accounting_coaching_logs_insert on accounting_coaching_logs;
create policy accounting_coaching_logs_insert on accounting_coaching_logs
  for insert with check (accounting_coaching_can_write());

drop policy if exists accounting_coaching_logs_update on accounting_coaching_logs;
create policy accounting_coaching_logs_update on accounting_coaching_logs
  for update using (
    company_id = auth_company_id()
    and (accounting_coaching_can_write() or employee_profile_id = auth_profile_id())
  )
  with check (company_id = auth_company_id());

-- No delete policy: rows are only ever soft-deleted (deleted_at).

drop policy if exists accounting_coaching_log_events_select on accounting_coaching_log_events;
create policy accounting_coaching_log_events_select on accounting_coaching_log_events
  for select using (company_id = auth_company_id() and accounting_coaching_can_read_all());

notify pgrst, 'reload schema';
