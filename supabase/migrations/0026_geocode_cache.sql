-- =====================================================================
-- 0026 — Geocode cache
-- Stores address → lat/lng results so the app never hits the Google
-- Geocoding API twice for the same address string. No TTL — physical
-- addresses don't move. Company-scoped via RLS so each company owns
-- its own cache rows.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists geocode_cache (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  address_hash text not null,          -- SHA-256 hex of the normalized address
  address_raw  text not null,          -- the original string (for debug / audit)
  lat          numeric(11, 8) not null,
  lng          numeric(11, 8) not null,
  cached_at    timestamptz not null default now()
);

-- One cache entry per (company, address_hash) pair
create unique index if not exists geocode_cache_company_hash
  on geocode_cache (company_id, address_hash);

-- Fast lookup by company + hash
create index if not exists geocode_cache_company_idx
  on geocode_cache (company_id);

-- RLS: users can only read/write their own company's cache
alter table geocode_cache enable row level security;

create policy "geocode_cache: company members can read"
  on geocode_cache for select
  using ( company_id = auth_company_id() );

create policy "geocode_cache: company members can insert"
  on geocode_cache for insert
  with check ( company_id = auth_company_id() );

-- No update / delete policy intentionally — cache rows are immutable
-- (addresses don't move).  Delete manually via Supabase dashboard if
-- a bad result needs clearing.
