-- =====================================================================
-- 0477 — eBay listings ↔ Truck Stock.
--
-- Parts → Parts Daily Report eBAY → Listings now ends a listing with
-- Sold / Ended (new status), and a sale comes off Truck Stock once:
--
--   * Listed → Sold   takes the listing's Qty off the matching Truck Stock
--                     row (same branch however it's spelled + same part #,
--                     ignoring case and spaces), never below 0. What was
--                     taken and from which row is kept on the listing
--                     (stock_taken / stock_row_id). "Sold only" (stock_skip)
--                     marks it Sold without touching Truck Stock — for a
--                     sale already taken off by hand.
--   * Sold → anything else, or deleting a Sold listing, puts back exactly
--                     what it took (only onto that same row; if the row was
--                     removed by a Truck Stock re-import, nothing is put back).
--   * Ended           listing taken down without a sale — no stock change.
--   * A Shipped eBay order dated 2026-11-25 or later marks the oldest
--     matching Listed listing (same branch + part #, listed on or before the
--     order date) Sold — which takes it off Truck Stock as above. The order
--     going back to Cancelled / Pending, or being deleted (incl. undoing an
--     import), puts that listing back to Listed and the stock back.
--     Orders dated before 2026-11-25 never do this: the Truck Stock
--     workbook already reflects those sales.
--   * Inserting a listing as Sold (an old sale typed in for the record)
--     changes nothing.
--
-- Listed listings count as "On eBay" on the Truck Stock page (worked out
-- from this table, nothing stored on truck_stock). Every quantity change
-- shows in that row's History (0464) under the person who did it.
--
-- Run once in the Supabase SQL Editor. Safe to rerun. Changes no existing
-- row: every current listing stays Listed and no stock moves until someone
-- marks a listing Sold or enters a Shipped order dated 2026-11-25 or later.
-- =====================================================================

-- ---------- Status: Listed / Sold / Ended ----------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'ebay_listings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table ebay_listings drop constraint %I', c.conname);
  end loop;
end $$;
alter table ebay_listings add constraint ebay_listings_status_check
  check (status in ('Listed', 'Sold', 'Ended'));

alter table ebay_listings add column if not exists sold_order_id     uuid references ebay_orders(id) on delete set null;
alter table ebay_listings add column if not exists stock_row_id      uuid references truck_stock(id) on delete set null;
alter table ebay_listings add column if not exists stock_taken       integer not null default 0;
alter table ebay_listings add column if not exists stock_skip        boolean not null default false;
alter table ebay_listings add column if not exists status_changed_at timestamptz;
alter table ebay_listings add column if not exists status_changed_by uuid references profiles(id) on delete set null;
create index if not exists idx_ebay_listings_sold_order on ebay_listings(sold_order_id) where sold_order_id is not null;
create index if not exists idx_ebay_listings_listed on ebay_listings(company_id, status) where status = 'Listed';

-- Part # as matched between eBay and Truck Stock: no spaces, capitals.
create or replace function ebay_part_key(p text)
returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '');
$$;

-- The Truck Stock row an eBay listing / order is for (IN STOCK first, then the most units).
create or replace function ebay_truck_stock_row(p_company uuid, p_branch text, p_part text)
returns uuid language sql stable as $$
  select t.id from truck_stock t
  where t.company_id = p_company
    and chain_norm_branch(t.branch) = chain_norm_branch(p_branch)
    and ebay_part_key(t.part_no) = ebay_part_key(p_part)
  order by (t.status = 'in_stock') desc, t.quantity desc, t.created_at
  limit 1;
$$;

-- ---------- Listing: Sold takes stock off once, leaving Sold / deleting puts it back ----------
create or replace function ebay_listing_truck_stock()
returns trigger language plpgsql set search_path = public as $$
declare
  v_row  uuid;
  v_have integer;
  v_take integer;
begin
  if tg_op = 'DELETE' then
    if old.status = 'Sold' and old.stock_taken > 0 and old.stock_row_id is not null then
      update truck_stock set quantity = quantity + old.stock_taken where id = old.stock_row_id;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- Typed in for the record: no stock change, nothing carried over.
    new.stock_taken := 0;
    new.stock_row_id := null;
    if new.status <> 'Listed' then
      new.status_changed_at := now();
      new.status_changed_by := auth_profile_id();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := auth_profile_id();
  end if;

  -- Leaving Sold: give back exactly what this listing took.
  if old.status = 'Sold' and new.status <> 'Sold' then
    if old.stock_taken > 0 and old.stock_row_id is not null then
      update truck_stock set quantity = quantity + old.stock_taken where id = old.stock_row_id;
    end if;
    new.stock_taken := 0;
    new.stock_row_id := null;
    new.stock_skip := false;
    new.sold_order_id := null;
    return new;
  end if;

  -- Becoming Sold: take the listing's Qty off its Truck Stock row, once.
  if new.status = 'Sold' and old.status <> 'Sold' then
    new.stock_taken := 0;
    new.stock_row_id := null;
    if not new.stock_skip then
      v_row := ebay_truck_stock_row(new.company_id, new.branch, new.part_no);
      if v_row is not null then
        select quantity into v_have from truck_stock where id = v_row for update;
        v_take := least(greatest(coalesce(new.quantity, 1), 1), greatest(coalesce(v_have, 0), 0));
        if v_take > 0 then
          update truck_stock set quantity = quantity - v_take where id = v_row;
          new.stock_taken := v_take;
          new.stock_row_id := v_row;
        end if;
      end if;
    end if;
    return new;
  end if;

  if new.status = 'Sold' then
    -- Staying Sold: what was taken stays as recorded (Qty / branch edits don't move stock again).
    new.stock_taken := old.stock_taken;
    new.stock_skip := old.stock_skip;
    -- …except the row link is let go when that Truck Stock row was deleted
    -- (the foreign key clears it; nothing to put back on Undo then).
    if new.stock_row_id is null and old.stock_row_id is not null
       and not exists (select 1 from truck_stock where id = old.stock_row_id) then
      new.stock_row_id := null;
    else
      new.stock_row_id := old.stock_row_id;
    end if;
  else
    -- Listed / Ended never hold stock.
    new.stock_taken := 0;
    new.stock_row_id := null;
    new.stock_skip := false;
    new.sold_order_id := null;
  end if;
  return new;
end;
$$;

-- Runs after trg_ebay_listings_stamp (names fire in order), so company_id is set.
drop trigger if exists trg_ebay_listings_truck_stock on ebay_listings;
create trigger trg_ebay_listings_truck_stock
  before insert or update or delete on ebay_listings
  for each row execute function ebay_listing_truck_stock();

-- ---------- Orders: a Shipped order sells the matching listing ----------
create or replace function ebay_order_sells_listing()
returns trigger language plpgsql set search_path = public as $$
declare
  v_listing uuid;
  v_moved   boolean := false;
  v_check   boolean := true;
begin
  if tg_op = 'DELETE' then
    update ebay_listings set status = 'Listed' where sold_order_id = old.id and status = 'Sold';
    return old;
  end if;

  if tg_op = 'UPDATE' then
    v_moved := ebay_part_key(new.part_no) is distinct from ebay_part_key(old.part_no)
            or chain_norm_branch(new.branch) is distinct from chain_norm_branch(old.branch);
    -- No longer a sale (or now for a different part / branch): put its listing back.
    if old.status = 'Shipped' and (new.status in ('Cancelled', 'Pending') or v_moved) then
      update ebay_listings set status = 'Listed' where sold_order_id = new.id and status = 'Sold';
    end if;
    -- Only look again when it just became Shipped or its part / branch / date changed
    -- (editing notes or earnings on a Shipped order never sells another listing).
    v_check := old.status is distinct from 'Shipped' or v_moved or new.order_date is distinct from old.order_date;
  end if;

  if v_check
     and new.status = 'Shipped'
     and new.order_date >= date '2026-11-25'
     and ebay_part_key(new.part_no) is not null
     and not exists (select 1 from ebay_listings where sold_order_id = new.id) then
    select l.id into v_listing from ebay_listings l
    where l.company_id = new.company_id
      and l.status = 'Listed'
      and chain_norm_branch(l.branch) = chain_norm_branch(new.branch)
      and ebay_part_key(l.part_no) = ebay_part_key(new.part_no)
      and l.listed_date <= new.order_date
    order by l.listed_date, l.created_at
    limit 1
    for update;
    if v_listing is not null then
      update ebay_listings set status = 'Sold', sold_order_id = new.id, stock_skip = false where id = v_listing;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_ebay_orders_sell_listing on ebay_orders;
create trigger trg_ebay_orders_sell_listing
  after insert or update on ebay_orders
  for each row execute function ebay_order_sells_listing();

-- Before the row goes, so its listings can still be found (the foreign key
-- would otherwise clear sold_order_id first).
drop trigger if exists trg_ebay_orders_unsell_listing on ebay_orders;
create trigger trg_ebay_orders_unsell_listing
  before delete on ebay_orders
  for each row execute function ebay_order_sells_listing();

notify pgrst, 'reload schema';
