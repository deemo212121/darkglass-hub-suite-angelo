-- =====================================================================
-- 0019 — Model resources (Exploded View & Service Bulletin links)
--
-- Per-model reference links surfaced on the ticket detail page next to
-- Product Information. Keyed by (company_id, model) so any ticket with the
-- same model number automatically inherits the saved links.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists model_resources (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  model               text not null,
  exploded_view_url   text,
  service_bulletin_url text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references profiles(id),
  unique (company_id, model)
);

create index if not exists idx_model_resources_company on model_resources(company_id);

alter table model_resources enable row level security;
alter table model_resources force row level security;

-- Company-scoped policies (mirrors other tenant tables in 0001_init.sql)
drop policy if exists model_resources_select on model_resources;
create policy model_resources_select on model_resources
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists model_resources_insert on model_resources;
create policy model_resources_insert on model_resources
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists model_resources_update on model_resources;
create policy model_resources_update on model_resources
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists model_resources_delete on model_resources;
create policy model_resources_delete on model_resources
  for delete using (company_id = auth_company_id() or is_superadmin());

-- Auto-stamp company_id on insert (same pattern as 0001_init.sql)
drop trigger if exists trg_model_resources_company on model_resources;
create trigger trg_model_resources_company
  before insert on model_resources
  for each row execute function set_company_id();
