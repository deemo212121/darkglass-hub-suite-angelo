-- =====================================================================
-- 0449 — Password and Email Management: which platforms each email is on
--
-- The page now looks like the sheet HR / Admin kept by hand: one row per
-- email (who uses it, the email, its password) and a ✓ column per platform
-- that email is used on — AHS, ER, Discord, iWallet, Car IQ, Encompass,
-- Marcone, NSA, ServicePower, ServiceBench, Miele, Onpoint, GE, Samsung,
-- Electrolux, LG, LinkedIn, Wix, Facebook (the list lives in the app,
-- EmailVaultPage.tsx's VAULT_PLATFORMS).
--
-- Adds:
--   email_vault_entries.platforms   the platform names ticked for that email
--   email_vault_set_platforms(id, platforms)   tick / untick; same rule as
--                                   editing an email (anyone with access)
--   History: "Ticked GE; Unticked LG" on the History tab, like every edit
--
-- No data is touched: the new column starts empty for every email, and
-- nothing about who can open the page or see passwords changes.
--
-- Run once in the Supabase SQL Editor, after 0448. Safe to run again.
-- =====================================================================

alter table email_vault_entries add column if not exists platforms text[] not null default '{}';

-- Same as 0436, plus: platforms trimmed, blanks and repeats dropped.
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
  new.platforms := coalesce((
    select array_agg(distinct trim(x) order by trim(x)) from unnest(coalesce(new.platforms, '{}')) x
    where trim(coalesce(x, '')) <> ''
  ), '{}');
  new.updated_by := auth_profile_id();
  new.updated_at := now();
  return new;
end;
$$;

-- Same as 0436, plus the platform ticks in the History detail.
create or replace function email_vault_entries_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_added uuid[];
  v_removed uuid[];
  v_ticked text[];
  v_unticked text[];
  v_parts text[] := '{}';
begin
  if tg_op = 'INSERT' then
    perform email_vault_log(new.company_id, new.id, new.email, 'added',
      nullif(concat_ws('; ',
        case when cardinality(new.people) > 0 then 'People: ' || email_vault_names(new.people) end,
        case when cardinality(new.platforms) > 0 then 'Platforms: ' || array_to_string(new.platforms, ', ') end
      ), ''));
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
    v_ticked := array(select unnest(new.platforms) except select unnest(old.platforms) order by 1);
    v_unticked := array(select unnest(old.platforms) except select unnest(new.platforms) order by 1);
    if cardinality(v_ticked) > 0 then
      v_parts := v_parts || ('Ticked ' || array_to_string(v_ticked, ', '));
    end if;
    if cardinality(v_unticked) > 0 then
      v_parts := v_parts || ('Unticked ' || array_to_string(v_unticked, ', '));
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

create or replace function email_vault_set_platforms(p_id uuid, p_platforms text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  update email_vault_entries set platforms = coalesce(p_platforms, '{}')
  where id = p_id and company_id = auth_company_id();
  if not found then
    raise exception 'That email isn''t in the vault any more.';
  end if;
end;
$$;

revoke all on function email_vault_set_platforms(uuid, text[]) from public, anon;
grant execute on function email_vault_set_platforms(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
