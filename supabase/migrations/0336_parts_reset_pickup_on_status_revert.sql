-- =====================================================================
-- 0336 — Reset "picked up" when a part's status goes back.
--
-- Part Daily Pickup's ✓ (parts.picked_up / picked_up_date) is separate from
-- the part's status. If the status is moved BACK to before pickup — Need PO,
-- PO Made or Part Ready (set by mistake, visit rescheduled, …) — the ✓ used
-- to stay, so the part kept showing on Part Daily Collection as "picked up"
-- even though the technician never had it.
--
-- This clears picked_up / picked_up_date whenever the status changes to one
-- of those earlier statuses, no matter where the change came from (ticket
-- page, Part Receive, a sync). It only reacts to the status change — it
-- doesn't touch distributor integrations or any other field.
--
-- Run once in the Supabase SQL Editor, after 0335.
-- =====================================================================

create or replace function parts_reset_pickup_on_status_revert()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and new.status in ('Need PO', 'PO Made', 'Part Ready')
     and (coalesce(new.picked_up, false) or new.picked_up_date is not null) then
    new.picked_up := false;
    new.picked_up_date := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_parts_reset_pickup_on_status_revert on parts;
create trigger trg_parts_reset_pickup_on_status_revert before update on parts
  for each row execute function parts_reset_pickup_on_status_revert();
