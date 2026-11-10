-- =====================================================================
-- 0436 — Admin → Email Vault.
--
-- Company email logins: the address, its password, and the people who use
-- that mailbox. Super Admin always has access; a Super Admin adds anyone
-- else from the page itself (email_vault_access) — by person, not by role.
--
-- Passwords live in their own table (email_vault_secrets) that signed-in
-- users can't read or write directly, so they never come down with the
-- list. Adding / editing goes through email_vault_add / email_vault_update,
-- and a password is read one at a time through email_vault_reveal, which
-- records who viewed or copied it. Every add / edit / password change /
-- delete and every access grant / removal is recorded in
-- email_vault_events by trigger or inside those functions, so none of it
-- can be skipped.
--
-- New tables and functions only — nothing outside them is changed.
-- Safe to rerun. Run once in the Supabase SQL Editor, after 0435.
-- =====================================================================

create table if not exists email_vault_access (
  company_id  uuid not null references companies(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  granted_by  uuid references profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (company_id, profile_id)
);

-- Super Admin (primary or extra role), or added to email_vault_access.
create or replace function email_vault_can_access()
returns boolean language sql stable security definer set search_path = public as $$
  select is_company_superadmin() or exists (
    select 1 from email_vault_access a
    where a.company_id = auth_company_id() and a.profile_id = auth_profile_id()
  );
$$;

create table if not exists email_vault_entries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  email       text not null,
  -- profiles.id of the people who use this mailbox
  people      uuid[] not null default '{}',
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_email_vault_entries_company on email_vault_entries(company_id, email);

create table if not exists email_vault_secrets (
  entry_id  uuid primary key references email_vault_entries(id) on delete cascade,
  password  text not null default ''
);

create table if not exists email_vault_events (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  -- no foreign key: a deleted entry keeps its history
  entry_id          uuid,
  email             text,
  action            text not null check (action in ('added', 'edited', 'password_changed', 'deleted', 'viewed', 'copied', 'access_granted', 'access_removed')),
  detail            text,
  actor_profile_id  uuid references profiles(id) on delete set null,
  actor_name        text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_email_vault_events_company on email_vault_events(company_id, created_at desc);

-- ---------------------------------------------------------------------
-- History helpers — callable only from the triggers / functions below.
-- ---------------------------------------------------------------------
create or replace function email_vault_names(p_ids uuid[])
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(coalesce(display_name, email, 'Unknown'), ', ' order by display_name), '')
  from profiles where id = any(p_ids);
$$;

create or replace function email_vault_log(p_company uuid, p_entry uuid, p_email text, p_action text, p_detail text)
returns void language sql security definer set search_path = public as $$
  insert into email_vault_events (company_id, entry_id, email, action, detail, actor_profile_id, actor_name)
  values (p_company, p_entry, p_email, p_action, nullif(p_detail, ''), auth_profile_id(), (select display_name from profiles where id = auth_profile_id()));
$$;

revoke all on function email_vault_names(uuid[]) from public, anon, authenticated;
revoke all on function email_vault_log(uuid, uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Entries: stamp company / who / when, keep people to this company.
-- ---------------------------------------------------------------------
create or replace function email_vault_entries_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.company_id := auth_company_id();
    new.created_by := auth_profile_id();
    new.created_at := now();
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.email := trim(coalesce(new.email, ''));
  if new.email = '' then
    raise exception 'Enter the email address.';
  end if;
  new.people := coalesce((
    select array_agg(distinct p.id) from profiles p
    where p.id = any(coalesce(new.people, '{}')) and p.company_id = new.company_id
  ), '{}');
  new.updated_by := auth_profile_id();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_email_vault_entries_before_write on email_vault_entries;
create trigger trg_email_vault_entries_before_write
  before insert or update on email_vault_entries
  for each row execute function email_vault_entries_before_write();

create or replace function email_vault_entries_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_added uuid[];
  v_removed uuid[];
  v_parts text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform email_vault_log(new.company_id, new.id, new.email, 'added',
      case when cardinality(new.people) > 0 then 'People: ' || email_vault_names(new.people) end);
  elsif tg_op = 'UPDATE' then
    if new.email is distinct from old.email then
      v_parts := v_parts || ('Email ' || old.email || ' → ' || new.email);
    end if;
    v_added := array(select unnest(new.people) except select unnest(old.people));
    v_removed := array(select unnest(old.people) except select unnest(new.people));
    if cardinality(v_added) > 0 then
      v_parts := v_parts || ('Added ' || email_vault_names(v_added));
    end if;
    if cardinality(v_removed) > 0 then
      v_parts := v_parts || ('Removed ' || email_vault_names(v_removed));
    end if;
    if cardinality(v_parts) > 0 then
      perform email_vault_log(new.company_id, new.id, new.email, 'edited', array_to_string(v_parts, '; '));
    end if;
  else
    perform email_vault_log(old.company_id, old.id, old.email, 'deleted', null);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_email_vault_entries_after_write on email_vault_entries;
create trigger trg_email_vault_entries_after_write
  after insert or update or delete on email_vault_entries
  for each row execute function email_vault_entries_after_write();

-- ---------------------------------------------------------------------
-- Access list: stamp company / who granted, same-company people only.
-- ---------------------------------------------------------------------
create or replace function email_vault_access_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.company_id := auth_company_id();
  new.granted_by := auth_profile_id();
  new.granted_at := now();
  if not exists (select 1 from profiles where id = new.profile_id and company_id = new.company_id) then
    raise exception 'That person isn''t in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_vault_access_before_insert on email_vault_access;
create trigger trg_email_vault_access_before_insert
  before insert on email_vault_access
  for each row execute function email_vault_access_before_insert();

create or replace function email_vault_access_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform email_vault_log(new.company_id, null, null, 'access_granted', email_vault_names(array[new.profile_id]));
  else
    perform email_vault_log(old.company_id, null, null, 'access_removed', email_vault_names(array[old.profile_id]));
  end if;
  return null;
end;
$$;

drop trigger if exists trg_email_vault_access_after_write on email_vault_access;
create trigger trg_email_vault_access_after_write
  after insert or delete on email_vault_access
  for each row execute function email_vault_access_after_write();

-- ---------------------------------------------------------------------
-- Add / edit (with the password) and read one password.
-- ---------------------------------------------------------------------
create or replace function email_vault_add(p_email text, p_password text, p_people uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  insert into email_vault_entries (email, people) values (p_email, coalesce(p_people, '{}')) returning id into v_id;
  insert into email_vault_secrets (entry_id, password) values (v_id, coalesce(p_password, ''));
  return v_id;
end;
$$;

-- p_password null = keep the current password.
create or replace function email_vault_update(p_id uuid, p_email text, p_people uuid[], p_password text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row email_vault_entries;
  v_old text;
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  select * into v_row from email_vault_entries where id = p_id and company_id = auth_company_id();
  if not found then
    raise exception 'That email isn''t in the vault any more.';
  end if;
  update email_vault_entries set email = p_email, people = coalesce(p_people, '{}') where id = p_id;
  if p_password is not null then
    select password into v_old from email_vault_secrets where entry_id = p_id;
    if v_old is distinct from p_password then
      insert into email_vault_secrets (entry_id, password) values (p_id, p_password)
        on conflict (entry_id) do update set password = excluded.password;
      perform email_vault_log(v_row.company_id, p_id, trim(p_email), 'password_changed', null);
    end if;
  end if;
end;
$$;

create or replace function email_vault_reveal(p_entry_id uuid, p_copy boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_row email_vault_entries;
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  select * into v_row from email_vault_entries where id = p_entry_id and company_id = auth_company_id();
  if not found then
    raise exception 'That email isn''t in the vault any more.';
  end if;
  perform email_vault_log(v_row.company_id, v_row.id, v_row.email, case when p_copy then 'copied' else 'viewed' end, null);
  return coalesce((select password from email_vault_secrets where entry_id = p_entry_id), '');
end;
$$;

revoke all on function email_vault_can_access() from public, anon;
revoke all on function email_vault_add(text, text, uuid[]) from public, anon;
revoke all on function email_vault_update(uuid, text, uuid[], text) from public, anon;
revoke all on function email_vault_reveal(uuid, boolean) from public, anon;
grant execute on function email_vault_can_access() to authenticated;
grant execute on function email_vault_add(text, text, uuid[]) to authenticated;
grant execute on function email_vault_update(uuid, text, uuid[], text) to authenticated;
grant execute on function email_vault_reveal(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- RLS. Entries are added / edited only through the functions above;
-- secrets have no policies at all, so only those functions reach them.
-- ---------------------------------------------------------------------
revoke all on email_vault_secrets from anon, authenticated;
revoke all on email_vault_entries from anon;
revoke all on email_vault_access from anon;
revoke all on email_vault_events from anon;
revoke insert, update, delete on email_vault_events from authenticated;

alter table email_vault_entries enable row level security;
alter table email_vault_secrets enable row level security;
alter table email_vault_access enable row level security;
alter table email_vault_events enable row level security;

drop policy if exists email_vault_entries_select on email_vault_entries;
create policy email_vault_entries_select on email_vault_entries
  for select using (company_id = auth_company_id() and email_vault_can_access());
drop policy if exists email_vault_entries_delete on email_vault_entries;
create policy email_vault_entries_delete on email_vault_entries
  for delete using (company_id = auth_company_id() and email_vault_can_access());

drop policy if exists email_vault_access_select on email_vault_access;
create policy email_vault_access_select on email_vault_access
  for select using (company_id = auth_company_id() and email_vault_can_access());
drop policy if exists email_vault_access_insert on email_vault_access;
create policy email_vault_access_insert on email_vault_access
  for insert with check (company_id = auth_company_id() and is_company_superadmin());
drop policy if exists email_vault_access_delete on email_vault_access;
create policy email_vault_access_delete on email_vault_access
  for delete using (company_id = auth_company_id() and is_company_superadmin());

drop policy if exists email_vault_events_select on email_vault_events;
create policy email_vault_events_select on email_vault_events
  for select using (company_id = auth_company_id() and email_vault_can_access());

notify pgrst, 'reload schema';
