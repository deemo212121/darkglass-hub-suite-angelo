-- =====================================================================
-- 0393 — Expenses: only Accounting approves, rejects or reimburses.
--
-- Changing an expense's status (Pending → Approved / Rejected / Reimbursed,
-- or back) is Accounting's call: FINANCE, plus ADMIN / SUPERADMIN /
-- SUPERSUPERADMIN — primary or extra role. Everyone else can still add and
-- edit their own expense requests; only the status (and who reviewed it)
-- is protected. Server-side jobs (service role, no signed-in user) are not
-- affected.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create or replace function expenses_review_accounting_only()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_roles text[];
begin
  if new.status is not distinct from old.status
     and new.reviewed_by is not distinct from old.reviewed_by then
    return new;
  end if;
  if auth_profile_id() is null then
    return new; -- server-side / service role
  end if;
  select array_append(coalesce(p.extra_roles, '{}'), p.role) into v_roles
  from profiles p where p.id = auth_profile_id();
  if not exists (
    select 1 from unnest(coalesce(v_roles, '{}')) r
    where upper(replace(trim(r), ' ', '_')) in ('FINANCE', 'ADMIN', 'SUPERADMIN', 'SUPERSUPERADMIN')
  ) then
    raise exception 'Only Accounting can approve, reject or reimburse expenses.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expenses_review_accounting_only on expenses;
create trigger trg_expenses_review_accounting_only
  before update on expenses
  for each row execute function expenses_review_accounting_only();
