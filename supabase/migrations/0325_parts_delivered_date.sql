-- Carrier-confirmed delivery date for a part's inbound shipment, looked up
-- from the tracking number (in_tracking) through Marcone's
-- /orders/trackpackage endpoint (FedEx + UPS). Distinct from received_date,
-- which is when branch staff marked the part received on Part Receive.
alter table public.parts add column if not exists delivered_date date;
alter table public.parts add column if not exists delivered_location text;
