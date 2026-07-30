-- Part Return's "select rows, pick a reason/qty, submit a return batch"
-- workflow needs two real fields the reference system's own Reason and
-- Return Qty columns capture that nothing here backed yet.
alter table parts add column if not exists return_reason text;
alter table parts add column if not exists return_qty numeric(10,2);
