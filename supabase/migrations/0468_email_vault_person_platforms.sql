-- =====================================================================
-- 0468 — Password and Email Management: tick platforms for people who
--        have "No email yet".
--
-- Ticks were saved on an email (email_vault_entries.platforms, 0449), so a
-- person without one couldn't be ticked. Now their ticks are saved on the
-- person here. When an email is added for them later, the app puts their
-- ticks on that new email.
--
-- Same people who can tick emails (email_vault_can_access()). Every tick /
-- untick is recorded on the History tab ("Edited — <name>: Ticked …").
--
-- New table and function only — no existing data is changed.
-- Run once in the Supabase SQL Editor, after 0467. Safe to run again.
-- =====================================================================

create table if not exists email_vault_person_platforms (
  company_id  uuid not null references companies(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  platforms   text[] not null default '{}',
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, profile_id)
);

create or replace function email_vault_set_person_platforms(p_profile_id uuid, p_platforms text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := auth_company_id();
  v_name text;
  v_old text[];
  v_new text[];
  v_ticked text[];
  v_unticked text[];
  v_parts text[] := '{}';
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  select coalesce(nullif(btrim(display_name), ''), email) into v_name from profiles where id = p_profile_id and company_id = v_company;
  if v_name is null then
    raise exception 'That person isn''t in this company.';
  end if;
  v_new := coalesce((
    select array_agg(distinct btrim(x) order by btrim(x)) from unnest(coalesce(p_platforms, '{}')) x
    where btrim(coalesce(x, '')) <> ''
  ), '{}');
  select platforms into v_old from email_vault_person_platforms where company_id = v_company and profile_id = p_profile_id;
  v_old := coalesce(v_old, '{}');

  insert into email_vault_person_platforms (company_id, profile_id, platforms, updated_by, updated_at)
  values (v_company, p_profile_id, v_new, auth_profile_id(), now())
  on conflict (company_id, profile_id) do update
    set platforms = excluded.platforms, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  v_ticked := array(select unnest(v_new) except select unnest(v_old) order by 1);
  v_unticked := array(select unnest(v_old) except select unnest(v_new) order by 1);
  if cardinality(v_ticked) > 0 then v_parts := v_parts || ('Ticked ' || array_to_string(v_ticked, ', ')); end if;
  if cardinality(v_unticked) > 0 then v_parts := v_parts || ('Unticked ' || array_to_string(v_unticked, ', ')); end if;
  if cardinality(v_parts) > 0 then
    perform email_vault_log(v_company, null, null, 'edited', v_name || ' (no email yet): ' || array_to_string(v_parts, '; '));
  end if;
end;
$$;

revoke all on function email_vault_set_person_platforms(uuid, text[]) from public, anon;
grant execute on function email_vault_set_person_platforms(uuid, text[]) to authenticated;

-- RLS: read by anyone with access; written only through the function above.
revoke all on email_vault_person_platforms from anon;
revoke insert, update, delete on email_vault_person_platforms from authenticated;
grant select on email_vault_person_platforms to authenticated;
alter table email_vault_person_platforms enable row level security;

drop policy if exists email_vault_person_platforms_select on email_vault_person_platforms;
create policy email_vault_person_platforms_select on email_vault_person_platforms
  for select using (company_id = auth_company_id() and email_vault_can_access());

notify pgrst, 'reload schema';
