-- =====================================================================
-- 0439 — Email Vault: two levels of access.
--
--   Email only          — sees the email addresses and who uses each one;
--                         can't show or copy a password, or set one.
--   Email and password  — also shows / copies passwords and sets them.
-- Super Admin always has both. A Super Admin picks each person's level in
-- Manage access, and can move people between the two.
--
-- Everyone already added keeps access, as Email only — a Super Admin moves
-- whoever should see passwords. The database enforces it
-- (email_vault_reveal / _add / _update), not just the page, and every
-- change of level is recorded on the History tab.
--
-- Adds one column and replaces the vault's functions — nothing else changes.
-- Safe to rerun. Run once in the Supabase SQL Editor, after 0438.
-- =====================================================================

alter table email_vault_access add column if not exists can_see_password boolean not null default false;

-- Super Admin, or added with Email and password.
create or replace function email_vault_can_see_password()
returns boolean language sql stable security definer set search_path = public as $$
  select is_company_superadmin() or exists (
    select 1 from email_vault_access a
    where a.company_id = auth_company_id() and a.profile_id = auth_profile_id() and a.can_see_password
  );
$$;
revoke all on function email_vault_can_see_password() from public, anon;
grant execute on function email_vault_can_see_password() to authenticated;

-- History: a new kind of entry for a change of level.
alter table email_vault_events drop constraint if exists email_vault_events_action_check;
alter table email_vault_events add constraint email_vault_events_action_check
  check (action in ('added', 'edited', 'password_changed', 'deleted', 'viewed', 'copied', 'access_granted', 'access_removed', 'access_changed'));

-- ---------------------------------------------------------------------
-- Changing someone's level: only the level can change.
-- ---------------------------------------------------------------------
create or replace function email_vault_access_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.company_id := old.company_id;
  new.profile_id := old.profile_id;
  new.granted_by := old.granted_by;
  new.granted_at := old.granted_at;
  return new;
end;
$$;

drop trigger if exists trg_email_vault_access_before_update on email_vault_access;
create trigger trg_email_vault_access_before_update
  before update on email_vault_access
  for each row execute function email_vault_access_before_update();

create or replace function email_vault_access_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_level text;
begin
  if tg_op = 'DELETE' then
    perform email_vault_log(old.company_id, null, null, 'access_removed', email_vault_names(array[old.profile_id]));
    return null;
  end if;
  v_level := case when new.can_see_password then 'email and password' else 'email only' end;
  if tg_op = 'INSERT' then
    perform email_vault_log(new.company_id, null, null, 'access_granted', email_vault_names(array[new.profile_id]) || ' (' || v_level || ')');
  elsif new.can_see_password is distinct from old.can_see_password then
    perform email_vault_log(new.company_id, null, null, 'access_changed', email_vault_names(array[new.profile_id]) || ': now ' || v_level);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_email_vault_access_after_write on email_vault_access;
create trigger trg_email_vault_access_after_write
  after insert or update or delete on email_vault_access
  for each row execute function email_vault_access_after_write();

drop policy if exists email_vault_access_update on email_vault_access;
create policy email_vault_access_update on email_vault_access
  for update using (company_id = auth_company_id() and is_company_superadmin())
  with check (company_id = auth_company_id() and is_company_superadmin());

-- ---------------------------------------------------------------------
-- Passwords: only with Email and password (or Super Admin).
-- ---------------------------------------------------------------------
create or replace function email_vault_add(p_email text, p_password text, p_people uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  if coalesce(p_password, '') <> '' and not email_vault_can_see_password() then
    raise exception 'You can see the email addresses but not the passwords, so you can''t set one — a Super Admin can give you password access in Manage access.';
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
  if p_password is not null and not email_vault_can_see_password() then
    raise exception 'You can see the email addresses but not the passwords, so you can''t change one — a Super Admin can give you password access in Manage access.';
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
  if not email_vault_can_see_password() then
    raise exception 'You can see the email addresses but not the passwords — a Super Admin can give you password access in Manage access.';
  end if;
  select * into v_row from email_vault_entries where id = p_entry_id and company_id = auth_company_id();
  if not found then
    raise exception 'That email isn''t in the vault any more.';
  end if;
  perform email_vault_log(v_row.company_id, v_row.id, v_row.email, case when p_copy then 'copied' else 'viewed' end, null);
  return coalesce((select password from email_vault_secrets where entry_id = p_entry_id), '');
end;
$$;

revoke all on function email_vault_add(text, text, uuid[]) from public, anon;
revoke all on function email_vault_update(uuid, text, uuid[], text) from public, anon;
revoke all on function email_vault_reveal(uuid, boolean) from public, anon;
grant execute on function email_vault_add(text, text, uuid[]) to authenticated;
grant execute on function email_vault_update(uuid, text, uuid[], text) to authenticated;
grant execute on function email_vault_reveal(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
