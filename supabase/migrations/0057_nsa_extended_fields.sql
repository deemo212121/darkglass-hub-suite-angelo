-- =====================================================================
-- 0057 — NSA extended dispatch fields
-- Adds columns for NSA dispatch data that had no home in the schema yet
-- (latitude/longitude, status code, part-order flags, depot-received
-- timestamp, schedule-ack user, etc.) plus customers.country. Previously
-- these fields were silently dropped on every NSA sync.
-- =====================================================================

alter table tickets
  add column if not exists nsa_latitude numeric,
  add column if not exists nsa_longitude numeric,
  add column if not exists nsa_status_code text,
  add column if not exists nsa_dispatch_codes jsonb,
  add column if not exists nsa_has_part_bom boolean,
  add column if not exists nsa_part_bom_required boolean,
  add column if not exists nsa_sf_can_add_part boolean,
  add column if not exists nsa_sf_can_order_parts boolean,
  add column if not exists nsa_program text,
  add column if not exists nsa_api_close boolean,
  add column if not exists nsa_hash text,
  add column if not exists nsa_legacy_file_name text,
  add column if not exists nsa_datetime_depot_received timestamptz,
  add column if not exists nsa_schedule_ack_by_user_id text,
  add column if not exists nsa_schedule_ack_by_user_name text;

alter table customers
  add column if not exists country text;
