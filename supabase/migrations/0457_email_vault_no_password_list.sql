-- =====================================================================
-- 0457 — Password and Email Management: show "(none)" straight away.
--
-- Read-only — no data is changed, no table is changed.
--
-- Lists which emails have NO password saved yet (only the ids — never a
-- password), so the list can show "(none)" with a Set password button
-- instead of making you click the eye first. Only for people who can
-- see passwords (Super Admin, or added as Email and password); everyone
-- else gets an empty list.
--
-- Until this is run the page works as before (eye icon on every row).
-- Safe to run again. Run once in the Supabase SQL Editor.
-- =====================================================================

create or replace function email_vault_no_password_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select e.id
  from email_vault_entries e
  left join email_vault_secrets s on s.entry_id = e.id
  where e.company_id = auth_company_id()
    and email_vault_can_see_password()
    and coalesce(s.password, '') = '';
$$;

revoke all on function email_vault_no_password_ids() from public, anon;
grant execute on function email_vault_no_password_ids() to authenticated;

notify pgrst, 'reload schema';
