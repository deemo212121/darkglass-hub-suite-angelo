-- =====================================================================
-- 0442 — Password Checks: Show password (Super Admin).
--
-- 0441 kept only a bcrypt hash of a check's set password, which can't be
-- turned back into the password. This keeps the password itself too, in the
-- same locked table (password_check_secrets — no policies, no grants; only
-- these functions read it), so a Super Admin can see it with Show password.
-- Every Show is written to password_check_events ("Password shown"), never
-- the password. The hash is still what typed passwords are checked against.
--
-- A password set before this runs has no readable copy — Show says so; set
-- it again with Edit password once.
--
-- Safe to run again. Run once in the Supabase SQL Editor, after 0441.
-- =====================================================================

alter table password_check_secrets add column if not exists password_text text;

alter table password_check_events drop constraint if exists password_check_events_action_check;
alter table password_check_events add constraint password_check_events_action_check
  check (action in ('added', 'changed', 'removed', 'password_set', 'password_viewed'));

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
  insert into password_check_secrets (check_id, password_hash, password_text) values (v_id, crypt(p_password, gen_salt('bf')), p_password)
    on conflict (check_id) do update set password_hash = excluded.password_hash, password_text = excluded.password_text;
  delete from password_check_attempts where check_id = v_id;
  insert into password_check_events (company_id, check_key, label, action, detail, actor_name)
  select company_id, check_key, label, 'password_set', 'Password changed', v_name from password_checks where id = v_id;
end;
$$;

-- Super Admin: the check's set password. Recorded as "Password shown".
create or replace function reveal_password_check_password(p_key text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_text text;
  v_found boolean;
begin
  if not password_check_is_admin() then
    raise exception 'Only a Super Admin can see this password.';
  end if;
  select c.id, s.password_text, s.check_id is not null into v_id, v_text, v_found
  from password_checks c left join password_check_secrets s on s.check_id = c.id
  where c.company_id = auth_company_id() and c.check_key = p_key;
  if v_id is null or not coalesce(v_found, false) then
    raise exception 'No password is set for this yet.';
  end if;
  if v_text is null then
    raise exception 'This password was set before Show password was added, so it can''t be shown — set it again with Edit password.';
  end if;
  insert into password_check_events (company_id, check_key, label, action, detail, actor_name)
  select company_id, check_key, label, 'password_viewed', '', (select display_name from profiles where id = auth_profile_id())
  from password_checks where id = v_id;
  return v_text;
end;
$$;

revoke all on function reveal_password_check_password(text) from public, anon;
grant execute on function reveal_password_check_password(text) to authenticated;
