-- =====================================================================
-- 0478 — Truck Stock: MISSING status and the Missing list.
--
-- Part Inventory → Truck Stock. Setting a row's Status to MISSING asks how
-- many can't be found (and a note); those units come off the row onto the
-- Missing list (truck_stock_missing) with who and when, and the row keeps
-- the rest (or shows MISSING with 0 when none are left). Missing units
-- never count as stock. Found (truck_stock_missing_found) puts them back on
-- the row as IN STOCK — or adds the row again if it was removed since — and
-- keeps the entry as a record (found_at / found_by).
--
-- Workbook import: rows marked MISSING or LOST land on the Missing list
-- (source = 'import'); importing the file again updates that open entry's
-- count instead of adding another.
--
-- Used without a ticket needs nothing here: truck_stock_used.ticket_no is
-- already '' when there's no ticket (0422); the reason goes in its notes.
--
-- Same company scoping / RLS as truck_stock (0023). Run once in the
-- Supabase SQL Editor. Safe to rerun. Changes no existing row.
-- =====================================================================

-- ---------- Status: + missing ----------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'truck_stock'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table truck_stock drop constraint %I', c.conname);
  end loop;
end $$;
alter table truck_stock add constraint truck_stock_status_check
  check (status in ('in_stock', 'in_use', 'sold', 'ebay', 'b2b', 'return', 'ticket', 'used', 'missing'));

-- ---------- The Missing list ----------
create table if not exists truck_stock_missing (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  -- The stock row it came off (cleared if that row is removed; Found then matches by branch + part #).
  truck_stock_id   uuid references truck_stock(id) on delete set null,
  branch           text not null,
  part_no          text not null,
  quantity         integer not null check (quantity > 0),
  description      text,
  storage_location text,
  notes            text,
  source           text not null default 'manual' check (source in ('manual', 'import')),
  reported_at      timestamptz not null default now(),
  reported_by      uuid references profiles(id) on delete set null,
  reported_by_name text,
  found_at         timestamptz,
  found_by         uuid references profiles(id) on delete set null,
  found_by_name    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_truck_stock_missing_company on truck_stock_missing(company_id, reported_at desc);
create index if not exists idx_truck_stock_missing_open on truck_stock_missing(company_id) where found_at is null;

create or replace function truck_stock_missing_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if tg_op = 'INSERT' then
    new.reported_by := coalesce(new.reported_by, auth_profile_id());
    new.reported_by_name := coalesce(nullif(btrim(new.reported_by_name), ''),
      (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = new.reported_by));
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_truck_stock_missing_stamp on truck_stock_missing;
create trigger trg_truck_stock_missing_stamp before insert or update on truck_stock_missing
  for each row execute function truck_stock_missing_stamp();

alter table truck_stock_missing enable row level security;
alter table truck_stock_missing force row level security;

drop policy if exists truck_stock_missing_select on truck_stock_missing;
create policy truck_stock_missing_select on truck_stock_missing
  for select using (company_id = auth_company_id() or is_superadmin());
drop policy if exists truck_stock_missing_insert on truck_stock_missing;
create policy truck_stock_missing_insert on truck_stock_missing
  for insert with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists truck_stock_missing_update on truck_stock_missing;
create policy truck_stock_missing_update on truck_stock_missing
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());
drop policy if exists truck_stock_missing_delete on truck_stock_missing;
create policy truck_stock_missing_delete on truck_stock_missing
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Found: put the units back on the stock row ----------
-- Runs as the caller (RLS applies). Returns the row's new quantity.
create or replace function truck_stock_missing_found(p_id uuid)
returns integer language plpgsql set search_path = public as $$
declare
  m     truck_stock_missing;
  v_row uuid;
  v_qty integer;
begin
  select * into m from truck_stock_missing where id = p_id for update;
  if not found then
    raise exception 'That Missing entry wasn''t found.';
  end if;
  if m.found_at is not null then
    raise exception 'Already marked Found.';
  end if;

  v_row := m.truck_stock_id;
  if v_row is not null and not exists (select 1 from truck_stock where id = v_row) then
    v_row := null;
  end if;
  if v_row is null then
    select t.id into v_row from truck_stock t
    where t.company_id = m.company_id
      and chain_norm_branch(t.branch) = chain_norm_branch(m.branch)
      and upper(btrim(t.part_no)) = upper(btrim(m.part_no))
    order by (t.status = 'in_stock') desc, t.quantity desc
    limit 1;
  end if;

  if v_row is null then
    insert into truck_stock (company_id, branch, part_no, description, storage_location, quantity, status)
    values (m.company_id, m.branch, m.part_no, m.description, m.storage_location, m.quantity, 'in_stock')
    returning id, quantity into v_row, v_qty;
  else
    update truck_stock
       set quantity = quantity + m.quantity,
           status = case when status = 'missing' then 'in_stock' else status end
     where id = v_row
    returning quantity into v_qty;
  end if;

  update truck_stock_missing
     set found_at = now(),
         found_by = auth_profile_id(),
         found_by_name = (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id()),
         truck_stock_id = v_row
   where id = p_id;
  return v_qty;
end;
$$;

grant execute on function truck_stock_missing_found(uuid) to authenticated;

notify pgrst, 'reload schema';
