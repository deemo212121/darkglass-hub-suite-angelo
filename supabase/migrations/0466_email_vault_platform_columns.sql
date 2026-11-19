-- =====================================================================
-- 0466 — Password and Email Management: add / delete the ✓ platform columns
--
-- The ✓ columns (AHS, ER, Discord … Facebook) were a fixed list in the app
-- (EmailVaultPage.tsx). Now each company keeps its own list here, and
-- anyone with access to the page can add a column or delete one — the
-- same people who can tick and untick (email_vault_can_access()).
--
-- Deleting a column doesn't untick anything: the ticks stay saved on each
-- email (email_vault_entries.platforms, 0449) and show again if a column
-- with that name is added back.
--
-- Adds:
--   email_vault_platforms                the columns, in order
--   email_vault_add_platform(name)       adds one at the end
--   email_vault_remove_platform(name)    deletes one
--   History: "Added column" / "Deleted column" on the History tab
--
-- No data is touched: every company starts with the same 19 columns the
-- page shows today, and no email's ticks change.
--
-- Run once in the Supabase SQL Editor, after 0465. Safe to run again (a
-- company that already has its list is left alone).
-- =====================================================================

create table if not exists email_vault_platforms (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  position    integer not null default 0,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_email_vault_platforms_name on email_vault_platforms (company_id, lower(name));

-- The 19 columns the page had built in, in the sheet's order.
insert into email_vault_platforms (company_id, name, position)
select c.id, d.name, d.position
from companies c
cross join unnest(array[
  'AHS', 'ER', 'Discord', 'iWallet', 'Car IQ', 'Encompass', 'Marcone', 'NSA', 'ServicePower', 'ServiceBench',
  'Miele', 'Onpoint', 'GE', 'Samsung', 'Electrolux', 'LG', 'LinkedIn', 'Wix', 'Facebook'
]) with ordinality as d(name, position)
where not exists (select 1 from email_vault_platforms p where p.company_id = c.id)
on conflict do nothing;

-- History: two new kinds of entry.
alter table email_vault_events drop constraint if exists email_vault_events_action_check;
alter table email_vault_events add constraint email_vault_events_action_check
  check (action in ('added', 'edited', 'password_changed', 'deleted', 'viewed', 'copied', 'access_granted', 'access_removed', 'access_changed', 'column_added', 'column_removed'));

create or replace function email_vault_add_platform(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := auth_company_id();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  if v_name = '' then
    raise exception 'Enter the platform name.';
  end if;
  if length(v_name) > 40 then
    raise exception 'Keep the platform name to 40 characters.';
  end if;
  if exists (select 1 from email_vault_platforms where company_id = v_company and lower(name) = lower(v_name)) then
    raise exception 'There''s already a % column.', v_name;
  end if;
  insert into email_vault_platforms (company_id, name, position, created_by)
  values (v_company, v_name, coalesce((select max(position) from email_vault_platforms where company_id = v_company), 0) + 1, auth_profile_id());
  perform email_vault_log(v_company, null, null, 'column_added', v_name || ' column');
end;
$$;

create or replace function email_vault_remove_platform(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := auth_company_id();
  v_name text;
  v_ticked integer;
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  delete from email_vault_platforms
  where company_id = v_company and lower(name) = lower(btrim(coalesce(p_name, '')))
  returning name into v_name;
  if v_name is null then
    raise exception 'That column isn''t there any more.';
  end if;
  select count(*) into v_ticked from email_vault_entries where company_id = v_company and v_name = any(platforms);
  perform email_vault_log(v_company, null, null, 'column_removed',
    v_name || ' column' || case when v_ticked > 0
      then ' — was ticked on ' || v_ticked || ' email' || case when v_ticked = 1 then '' else 's' end || ' (ticks kept; adding it back shows them again)'
      else '' end);
end;
$$;

revoke all on function email_vault_add_platform(text) from public, anon;
revoke all on function email_vault_remove_platform(text) from public, anon;
grant execute on function email_vault_add_platform(text) to authenticated;
grant execute on function email_vault_remove_platform(text) to authenticated;

-- RLS: read by anyone with access; added / deleted only through the functions above.
revoke all on email_vault_platforms from anon;
revoke insert, update, delete on email_vault_platforms from authenticated;
alter table email_vault_platforms enable row level security;

drop policy if exists email_vault_platforms_select on email_vault_platforms;
create policy email_vault_platforms_select on email_vault_platforms
  for select using (company_id = auth_company_id() and email_vault_can_access());

notify pgrst, 'reload schema';
