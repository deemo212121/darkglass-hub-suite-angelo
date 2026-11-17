-- =====================================================================
-- 0464 — Truck Stock history: who changed what on a stock row, and when.
--
-- Every add, change and delete of a truck_stock row — from the page, Import,
-- a transfer, anything — writes here from a trigger, so nothing can skip it:
--
--   added     the row was created (with its qty)
--   changed   one line per field that changed — status, description, brand
--             (manufacturer), qty, stored at, notes, branch, part no — with
--             the value before and after
--   deleted   the row was removed (history stays; branch + part no kept)
--
-- Who = the signed-in person (name kept as it was then); a change with no
-- one signed in (server jobs) is blank — shown as "System".
-- Part Inventory → Truck Stock → a row's History button lists it.
--
-- Read: everyone in the company who can open Truck Stock (same company
-- rule as truck_stock). Nobody writes it directly — only the trigger.
--
-- New table + trigger only — no existing data is changed. Run once in the
-- Supabase SQL Editor, after 0463. Safe to run again.
-- =====================================================================

create table if not exists truck_stock_history (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  -- No foreign key: the history stays after the row is deleted.
  truck_stock_id  uuid not null,
  branch          text,
  part_no         text,
  action          text not null check (action in ('added', 'changed', 'deleted')),
  field           text,
  before_value    text,
  after_value     text,
  changed_by      uuid references profiles(id) on delete set null,
  changed_by_name text,
  changed_at      timestamptz not null default now()
);
create index if not exists idx_truck_stock_history_row on truck_stock_history(truck_stock_id, changed_at desc);
create index if not exists idx_truck_stock_history_company on truck_stock_history(company_id, changed_at desc);

alter table truck_stock_history enable row level security;
drop policy if exists truck_stock_history_select on truck_stock_history;
create policy truck_stock_history_select on truck_stock_history
  for select using (company_id = auth_company_id());

create or replace function log_truck_stock_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth_profile_id();
  v_name  text := (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = v_actor);
  r       truck_stock;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'INSERT' then
    insert into truck_stock_history (company_id, truck_stock_id, branch, part_no, action, field, after_value, changed_by, changed_by_name)
    values (r.company_id, r.id, r.branch, r.part_no, 'added', 'quantity', new.quantity::text, v_actor, v_name);
  elsif tg_op = 'DELETE' then
    insert into truck_stock_history (company_id, truck_stock_id, branch, part_no, action, field, before_value, changed_by, changed_by_name)
    values (r.company_id, r.id, r.branch, r.part_no, 'deleted', 'quantity', old.quantity::text, v_actor, v_name);
  else
    insert into truck_stock_history (company_id, truck_stock_id, branch, part_no, action, field, before_value, after_value, changed_by, changed_by_name)
    select r.company_id, r.id, r.branch, r.part_no, 'changed', f.field, f.before_value, f.after_value, v_actor, v_name
    from (values
      ('status',           old.status,               new.status),
      ('description',      old.description,          new.description),
      ('manufacturer',     old.manufacturer,         new.manufacturer),
      ('quantity',         old.quantity::text,       new.quantity::text),
      ('storage_location', old.storage_location,     new.storage_location),
      ('notes',            old.notes,                new.notes),
      ('branch',           old.branch,               new.branch),
      ('part_no',          old.part_no,              new.part_no)
    ) as f(field, before_value, after_value)
    where f.before_value is distinct from f.after_value;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_truck_stock_history on truck_stock;
create trigger trg_truck_stock_history
  after insert or update or delete on truck_stock
  for each row execute function log_truck_stock_change();

notify pgrst, 'reload schema';
