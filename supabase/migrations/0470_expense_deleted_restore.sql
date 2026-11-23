-- =====================================================================
-- 0470 — Expenses: deleted requests can be restored.
--
-- Until now deleting an expense (Expenses → Delete, Employee Self-Service,
-- the mobile My Expenses screen) removed it for good.
--
-- (1) expense_deleted_log — every deleted expense is kept here as it was
--     (amount, status, receipts, who reviewed it …), with who deleted it
--     and when. Keeping the copy can NEVER block a delete: if it fails,
--     the delete still goes through (the failure is only skipped).
--
-- (2) expense_restore(log id) — puts a deleted expense back exactly as it
--     was (same id, same status). Accounting / Admin / Super Admin only.
--     Refused if it was already restored.
--
-- Who can see the deleted list: Accounting, Admin, Super Admin.
-- Nothing existing is changed. Expenses deleted BEFORE this is run can't
-- be brought back (nothing was kept then).
--
-- Run once in the Supabase SQL Editor, after 0469. Safe to run again.
-- =====================================================================

create table if not exists expense_deleted_log (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  expense_id             uuid not null,
  old_row                jsonb not null,
  deleted_by_profile_id  uuid references profiles(id) on delete set null,
  deleted_by_name        text,
  deleted_at             timestamptz not null default now(),
  restored_at            timestamptz,
  restored_by_name       text
);
create index if not exists idx_expense_deleted_log_open on expense_deleted_log(company_id, deleted_at desc) where restored_at is null;

create or replace function expense_deleted_log_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
begin
  begin
    insert into expense_deleted_log (company_id, expense_id, old_row, deleted_by_profile_id, deleted_by_name)
    values (
      old.company_id, old.id, to_jsonb(old), v_me,
      coalesce((select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = v_me), 'System')
    );
  exception when others then
    -- Never block a delete because the copy couldn't be kept.
    raise warning 'expense_deleted_log_write skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_expense_deleted_log on expenses;
create trigger trg_expense_deleted_log
  after delete on expenses
  for each row execute function expense_deleted_log_write();

create or replace function expense_restore(p_log_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_log expense_deleted_log;
begin
  if not (is_finance() or is_admin() or is_company_superadmin() or is_superadmin()) then
    raise exception 'Only Accounting, Admin or Super Admin can restore a deleted expense.';
  end if;
  select * into v_log from expense_deleted_log where id = p_log_id and company_id = auth_company_id() for update;
  if not found then
    raise exception 'That deleted expense isn''t in the list.';
  end if;
  if v_log.restored_at is not null then
    raise exception 'That expense was already restored.';
  end if;
  if exists (select 1 from expenses where id = v_log.expense_id) then
    raise exception 'That expense is already back.';
  end if;

  insert into expenses select * from jsonb_populate_record(null::expenses, v_log.old_row);

  update expense_deleted_log
  set restored_at = now(),
      restored_by_name = (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id())
  where id = p_log_id;
end;
$$;

revoke all on function expense_deleted_log_write() from public, anon, authenticated;
revoke all on function expense_restore(uuid) from public, anon;
grant execute on function expense_restore(uuid) to authenticated;

-- RLS: read by Accounting / Admin / Super Admin; written only by the trigger and the function above.
revoke all on expense_deleted_log from anon;
revoke insert, update, delete on expense_deleted_log from authenticated;
grant select on expense_deleted_log to authenticated;
alter table expense_deleted_log enable row level security;

drop policy if exists expense_deleted_log_select on expense_deleted_log;
create policy expense_deleted_log_select on expense_deleted_log
  for select using (
    company_id = auth_company_id()
    and (is_finance() or is_admin() or is_company_superadmin() or is_superadmin())
  );

notify pgrst, 'reload schema';
