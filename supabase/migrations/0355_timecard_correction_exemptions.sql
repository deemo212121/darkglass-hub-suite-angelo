-- ============================================================================
-- 0355 — Time correction exemptions (Employee Monitoring → Exceeded →
-- Time Corrections).
--
-- A correction with a valid reason (system outage, account issue…) can be
-- marked Exempt so it doesn't count toward the person's monthly limit.
-- Every exemption keeps who/when/why, and removing one never deletes the
-- row — it stamps removed_* instead, so the full history stays on record.
-- At most one ACTIVE exemption per correction.
--
-- Admin / HR / company Super Admin can exempt or remove; everyone in the
-- company can read (the tab itself is already access-gated).
-- ============================================================================

create table if not exists timecard_correction_exemptions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  correction_id     uuid not null references timecard_corrections(id) on delete cascade,
  reason            text not null check (length(btrim(reason)) > 0),
  exempted_by       uuid references profiles(id) on delete set null default auth_profile_id(),
  exempted_by_name  text,
  exempted_at       timestamptz not null default now(),
  removed_at        timestamptz,
  removed_by        uuid references profiles(id) on delete set null,
  removed_by_name   text,
  removed_reason    text
);

create unique index if not exists uq_timecard_correction_exemptions_active
  on timecard_correction_exemptions(correction_id) where removed_at is null;
create index if not exists idx_timecard_correction_exemptions_company
  on timecard_correction_exemptions(company_id, exempted_at desc);

drop trigger if exists trg_timecard_correction_exemptions_company on timecard_correction_exemptions;
create trigger trg_timecard_correction_exemptions_company
  before insert on timecard_correction_exemptions
  for each row execute function set_company_id();

alter table timecard_correction_exemptions enable row level security;

drop policy if exists timecard_correction_exemptions_select on timecard_correction_exemptions;
create policy timecard_correction_exemptions_select on timecard_correction_exemptions
  for select using (company_id = auth_company_id());

drop policy if exists timecard_correction_exemptions_insert on timecard_correction_exemptions;
create policy timecard_correction_exemptions_insert on timecard_correction_exemptions
  for insert with check (is_admin() or is_hr() or is_company_superadmin());

drop policy if exists timecard_correction_exemptions_update on timecard_correction_exemptions;
create policy timecard_correction_exemptions_update on timecard_correction_exemptions
  for update using (company_id = auth_company_id() and (is_admin() or is_hr() or is_company_superadmin()))
  with check (company_id = auth_company_id());
