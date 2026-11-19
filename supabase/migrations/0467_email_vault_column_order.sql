-- =====================================================================
-- 0467 — Password and Email Management: drag the ✓ columns into order.
--
-- Dragging a platform column header saves the new order here, for
-- everyone in the company (email_vault_platforms.position, 0466). Same
-- people who can add / delete columns (email_vault_can_access()).
--
-- Only the order changes — no column is added or deleted, no tick changes.
--
-- Run once in the Supabase SQL Editor, after 0466. Safe to run again.
-- =====================================================================

create or replace function email_vault_reorder_platforms(p_names text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := auth_company_id();
begin
  if not email_vault_can_access() then
    raise exception 'You don''t have access to the Email Vault.';
  end if;
  -- Named columns take the order given; any column not named keeps its place after them.
  update email_vault_platforms p
  set position = coalesce(
    (select min(t.i) from unnest(coalesce(p_names, '{}'::text[])) with ordinality as t(n, i) where lower(btrim(t.n)) = lower(p.name)),
    100000 + p.position
  )
  where p.company_id = v_company;
  -- Back to 1, 2, 3 …
  update email_vault_platforms p
  set position = r.rn
  from (select id, row_number() over (order by position, name) as rn from email_vault_platforms where company_id = v_company) r
  where p.id = r.id;
end;
$$;

revoke all on function email_vault_reorder_platforms(text[]) from public, anon;
grant execute on function email_vault_reorder_platforms(text[]) to authenticated;

notify pgrst, 'reload schema';
