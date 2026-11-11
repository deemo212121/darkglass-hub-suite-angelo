-- =====================================================================
-- 0441 — Password checks (Admin → Password and Email Management →
-- Password Checks button).
--
-- Some pages and buttons ask for a password before they open
-- (PasswordGateModal). Two are built into the app:
--   truck-stock-import                     Truck Stock → Import
--   employee-monitoring-attendance-status  Employee Monitoring → Attendance Status
-- A Super Admin can turn those off / on, pick how often they ask and which
-- password they take, and add the same check to any page:
-- check_key 'page:{module}/{submodule}'.
--
--   enabled       : ask (true) or don't (false)
--   frequency     : 'every_time'       — every time it's opened
--                   'once_per_session' — once, then not again in that browser tab
--   password_type : 'own' — the person's own login password (checked by
--                           Firebase in the browser; nothing stored here)
--                   'set' — a password a Super Admin sets for that check.
--                           Stored only as a bcrypt hash in
--                           password_check_secrets, which nobody can read;
--                           set_password_check_password writes it and
--                           verify_password_check checks a typed one
--                           (10 wrong tries in 15 minutes locks that person
--                           out of that check for a while).
--                           (0442 adds Show password for Super Admins.)
--
-- A built-in check with no row here uses the app's default (on, own
-- password). Everyone in the company can read the list (the app has to know
-- where to ask); only a Super Admin can change it. Every add / change /
-- remove / password change is written to password_check_events by trigger
-- or function — never the password itself.
--
-- New tables and functions only. Safe to run again. Run once in the
-- Supabase SQL Editor, after 0440.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists password_checks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  check_key        text not null check (check_key ~ '^[a-z0-9-]+$' or check_key ~ '^page:[a-z0-9-]+/[a-z0-9-]+$'),
  label            text not null default '',
  enabled          boolean not null default true,
  frequency        text not null default 'every_time' check (frequency in ('every_time', 'once_per_session')),
  password_type    text not null default 'own' check (password_type in ('own', 'set')),
  password_set_at  timestamptz,
  password_set_by_name text,
  updated_by_name  text,
  updated_at       timestamptz not null default now(),
  unique (company_id, check_key)
);

-- The set passwords, hashed. No policies: only the functions below touch it.
create table if not exists password_check_secrets (
  check_id       uuid primary key references password_checks(id) on delete cascade,
  password_hash  text not null
);

create table if not exists password_check_attempts (
  id          uuid primary key default gen_random_uuid(),
  check_id    uuid not null references password_checks(id) on delete cascade,
  profile_id  uuid references profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists idx_password_check_attempts on password_check_attempts(check_id, profile_id, created_at desc);

create table if not exists password_check_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  check_key   text not null,
  label       text not null default '',
  action      text not null check (action in ('added', 'changed', 'removed', 'password_set')),
  detail      text not null default '',
  actor_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_password_check_events_company on password_check_events(company_id, created_at desc);

create or replace function password_check_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select is_company_superadmin() or is_superadmin();
$$;

-- Stamps; password_set_at / _by only change through set_password_check_password.
create or replace function password_checks_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.check_key := old.check_key;
    if current_setting('password_checks.setting_password', true) is distinct from 'on' then
      new.password_set_at := old.password_set_at;
      new.password_set_by_name := old.password_set_by_name;
    end if;
  else
    new.company_id := auth_company_id();
    if current_setting('password_checks.setting_password', true) is distinct from 'on' then
      new.password_set_at := null;
      new.password_set_by_name := null;
    end if;
  end if;
  new.updated_by_name := (select display_name from profiles where id = auth_profile_id());
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_password_checks_before_write on password_checks;
create trigger trg_password_checks_before_write
  before insert or update on password_checks
  for each row execute function password_checks_before_write();

create or replace function password_checks_describe(p_enabled boolean, p_frequency text, p_type text)
returns text language sql immutable as $$
  select case when not p_enabled then 'Off'
    else 'On — ' || case when p_frequency = 'every_time' then 'every time' else 'once per session' end
      || ' — ' || case when p_type = 'set' then 'set password' else 'their own login password' end
  end;
$$;

create or replace function password_checks_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select display_name from profiles where id = auth_profile_id());
begin
  if tg_op = 'DELETE' then
    insert into password_check_events (company_id, check_key, label, action, detail, actor_name)
    values (old.company_id, old.check_key, old.label, 'removed', '', v_name);
    return old;
  end if;
  if tg_op = 'INSERT' then
    insert into password_check_events (company_id, check_key, label, action, detail, actor_name)
    values (new.company_id, new.check_key, new.label, 'added', password_checks_describe(new.enabled, new.frequency, new.password_type), v_name);
  elsif (new.enabled, new.frequency, new.password_type) is distinct from (old.enabled, old.frequency, old.password_type) then
    insert into password_check_events (company_id, check_key, label, action, detail, actor_name)
    values (new.company_id, new.check_key, new.label, 'changed', password_checks_describe(new.enabled, new.frequency, new.password_type), v_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_password_checks_after_write on password_checks;
create trigger trg_password_checks_after_write
  after insert or update or delete on password_checks
  for each row execute function password_checks_after_write();

-- ---------------------------------------------------------------------
-- Set password: Super Admin. Makes the row if the check has none yet
-- (a built-in one), switches it to the set password, stores the hash.
-- ---------------------------------------------------------------------
create or replace function set_password_check_password(p_key text, p_label text, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_name text := (select display_name from profiles where id = auth_profile_id());
begin
  if not password_check_is_admin() then
    raise exception 'Only a Super Admin can set this password.';
  end if;
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'Use at least 4 characters.';
  end if;
  perform set_config('password_checks.setting_password', 'on', true);
  select id into v_id from password_checks where company_id = auth_company_id() and check_key = p_key;
  if v_id is null then
    insert into password_checks (check_key, label, enabled, frequency, password_type, password_set_at, password_set_by_name)
    values (p_key, coalesce(nullif(p_label, ''), p_key), true, 'every_time', 'set', now(), v_name)
    returning id into v_id;
  else
    update password_checks set password_type = 'set', password_set_at = now(), password_set_by_name = v_name where id = v_id;
  end if;
  perform set_config('password_checks.setting_password', 'off', true);
  insert into password_check_secrets (check_id, password_hash) values (v_id, crypt(p_password, gen_salt('bf')))
    on conflict (check_id) do update set password_hash = excluded.password_hash;
  delete from password_check_attempts where check_id = v_id;
  insert into password_check_events (company_id, check_key, label, action, detail, actor_name)
  select company_id, check_key, label, 'password_set', 'Password changed', v_name from password_checks where id = v_id;
end;
$$;

-- Anyone in the company: is this the check's set password?
create or replace function verify_password_check(p_key text, p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_hash text;
  v_me uuid := auth_profile_id();
  v_ok boolean;
begin
  select c.id, s.password_hash into v_id, v_hash
  from password_checks c join password_check_secrets s on s.check_id = c.id
  where c.company_id = auth_company_id() and c.check_key = p_key;
  if v_id is null then
    raise exception 'No password is set for this yet — ask a Super Admin.';
  end if;
  if (select count(*) from password_check_attempts where check_id = v_id and profile_id = v_me and created_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many wrong tries — wait 15 minutes and try again.';
  end if;
  v_ok := crypt(coalesce(p_password, ''), v_hash) = v_hash;
  if v_ok then
    delete from password_check_attempts where check_id = v_id and profile_id = v_me;
  else
    insert into password_check_attempts (check_id, profile_id) values (v_id, v_me);
  end if;
  return v_ok;
end;
$$;

revoke all on function set_password_check_password(text, text, text) from public, anon;
revoke all on function verify_password_check(text, text) from public, anon;
grant execute on function set_password_check_password(text, text, text) to authenticated;
grant execute on function verify_password_check(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table password_checks enable row level security;
alter table password_check_secrets enable row level security;
alter table password_check_attempts enable row level security;
alter table password_check_events enable row level security;

drop policy if exists password_checks_select on password_checks;
create policy password_checks_select on password_checks
  for select using (company_id = (select auth_company_id()));

drop policy if exists password_checks_insert on password_checks;
create policy password_checks_insert on password_checks
  for insert with check ((select password_check_is_admin()));

drop policy if exists password_checks_update on password_checks;
create policy password_checks_update on password_checks
  for update using (company_id = (select auth_company_id()) and (select password_check_is_admin()))
              with check (company_id = (select auth_company_id()));

drop policy if exists password_checks_delete on password_checks;
create policy password_checks_delete on password_checks
  for delete using (company_id = (select auth_company_id()) and (select password_check_is_admin()));

drop policy if exists password_check_events_select on password_check_events;
create policy password_check_events_select on password_check_events
  for select using (company_id = (select auth_company_id()) and (select password_check_is_admin()));

grant select, insert, update, delete on password_checks to authenticated;
grant select on password_check_events to authenticated;
revoke all on password_check_secrets from anon, authenticated;
revoke all on password_check_attempts from anon, authenticated;

-- Open pages pick up a change right away.
do $$
begin
  alter publication supabase_realtime add table password_checks;
exception
  when duplicate_object then raise notice 'password_checks already in supabase_realtime publication';
  when undefined_object then raise notice 'no supabase_realtime publication here';
end $$;
