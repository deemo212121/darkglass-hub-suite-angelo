-- Return & Pickup tracks how many units of a return-authorized part have
-- actually been scanned out the door for shipment back to the distributor,
-- separate from the return authorization itself (ra_no/ra_date, already
-- on parts since 0001_init.sql).
alter table parts add column if not exists scan_out_qty numeric(10,2) not null default 0;
