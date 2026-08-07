-- =====================================================================
-- 0146 — Repair Statuses (Admin-configurable, real persistence)
--
-- Backs the rebuilt "Repair Statuses" admin page (RepairStatusesPage.tsx,
-- Admin module) — previously a pure localStorage mockup (ahs:repair-
-- statuses:rows) that never persisted anywhere real and didn't actually
-- restrict or color anything else in the app.
--
-- allowed_roles replaces the legacy screen's flat CSR / Part Mgr. / Tech.
-- checkboxes with this app's real role codes (see ROLE_OPTIONS,
-- roleLabels.ts) — deliberately NOT enforced anywhere else yet (no ticket
-- status dropdown filters by it). This is a saved reference/config table
-- for now; wiring real enforcement into every status picker across the
-- app is a distinct, larger follow-up.
--
-- No Samsung status-mapping column (the legacy screen's "Update
-- Dispatcher's Status: Samsung" dropdown) — this company has no Samsung
-- integration. service_power_status is kept (free text) since ServicePower
-- is a real, heavily-used integration here.
--
-- color is a hex string (#RRGGBB) for a real color-picker input, not the
-- legacy screen's named-color dropdown (Red/Black/Pink/...) — seeded
-- below with each legacy status's closest standard CSS color equivalent.
--
-- Seed data transcribed from the legacy EarlyRepair Repair Statuses
-- screen (21 rows). Same company_id caveat as other seed migrations this
-- project uses — resolved via legacy_code = 'COMP001', not a bare
-- `limit 1` (this Supabase project has a few unrelated demo/test
-- tenants). Every insert has `on conflict do nothing`, safe to re-run.
--
-- Run once in the Supabase SQL Editor, after 0145.
--
-- REVISION: the first two run attempts left this table in an inconsistent
-- physical schema (a "does not exist" error on one column, then a NOT NULL
-- violation with a failing-row dump that had MORE columns than this file
-- ever declared — some other partial/duplicate column set got mixed in).
-- Confirmed empty (0 rows) both times, so rather than keep patching an
-- unknown state with more IF NOT EXISTS additions, this drops and recreates
-- the table outright. Safe specifically because nothing real has ever been
-- saved into it yet.
-- =====================================================================

drop table if exists repair_statuses cascade;

create table if not exists repair_statuses (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references companies(id) on delete cascade,
  code                        text not null default '',
  description                 text not null default '',
  overall_status              text not null default 'Pending',
  initial_status              text,
  color                       text not null default '#888888',
  font_bold                   boolean not null default false,
  follow_up_dashboard         text,
  allowed_roles               text[] not null default '{}',
  csr_reschedule_status       boolean not null default false,
  part_pending_status         boolean not null default false,
  cx_requests_reschedule      boolean not null default false,
  dispatch_completed_status   boolean not null default false,
  mobile_search                boolean not null default false,
  hide_in_mobile               boolean not null default false,
  service_power_status        text,
  sort_order                   int not null default 0,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists idx_repair_statuses_company on repair_statuses(company_id);

create or replace function repair_statuses_stamp_and_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_repair_statuses_stamp on repair_statuses;
create trigger trg_repair_statuses_stamp before insert or update on repair_statuses
  for each row execute function repair_statuses_stamp_and_touch();

alter table repair_statuses enable row level security;
alter table repair_statuses force row level security;

drop policy if exists repair_statuses_select on repair_statuses;
create policy repair_statuses_select on repair_statuses
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists repair_statuses_insert on repair_statuses;
create policy repair_statuses_insert on repair_statuses
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists repair_statuses_update on repair_statuses;
create policy repair_statuses_update on repair_statuses
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists repair_statuses_delete on repair_statuses;
create policy repair_statuses_delete on repair_statuses
  for delete using (company_id = auth_company_id() or is_superadmin());

-- ---------- Seed data (legacy EarlyRepair Repair Statuses screen) ----------

insert into repair_statuses
  (company_id, code, description, overall_status, initial_status, color, font_bold, follow_up_dashboard, allowed_roles, csr_reschedule_status, part_pending_status, cx_requests_reschedule, dispatch_completed_status, mobile_search, hide_in_mobile, service_power_status, sort_order)
values
  ((select id from companies where legacy_code = 'COMP001'), 'ARC',   'Archived',                 'Cancelled',      'Archived',               '#FF0000', false, 'Do not show', array['ADMIN'],                                   false, false, false, false, false, true,  null,        1),
  ((select id from companies where legacy_code = 'COMP001'), 'BO',    'CL-Parts Back Ordered',    'Pending',        'Parts Back Ordered',    '#000000', false, 'Show All',     array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], true,  true,  true,  false, false, false, 'ACCEPTED',  2),
  ((select id from companies where legacy_code = 'COMP001'), 'CFU',   'CL-Data-Closed',           'Claimed',        'Claimed',                '#FFC0CB', true,  'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, false, false, false, true,  'COMPLETED', 3),
  ((select id from companies where legacy_code = 'COMP001'), 'CL',    'CL-Claimed',               'Claimed',        'Claimed',                '#800080', true,  'Show All',     array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, false, true,  true,  false, 'COMPLETED', 4),
  ((select id from companies where legacy_code = 'COMP001'), 'CN',    'CL-Cancelled',             'Cancelled',      'Cancelled',              '#FF00FF', false, 'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, true,  false, false, true,  null,        5),
  ((select id from companies where legacy_code = 'COMP001'), 'LM',    'CSR-Left Message for Cx',  'Pending',        'Accepted',               '#008080', false, 'Do not show', array['ADMIN','CSR'],                              true,  true,  false, false, false, true,  'ACCEPTED',  6),
  ((select id from companies where legacy_code = 'COMP001'), 'NA',    'PT-Need PreAuthorization', 'Pending',        'Accepted',               '#FF0000', false, 'Show All',     array['ADMIN','CSR','PARTS_MANAGER'],              true,  true,  false, false, false, false, 'ACCEPTED',  7),
  ((select id from companies where legacy_code = 'COMP001'), 'NAC',   'Needs Auto Claim',         'Completed',      'Confirmed',              '#FF0000', false, 'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, false, true,  false, true,  null,        8),
  ((select id from companies where legacy_code = 'COMP001'), 'NC',    'CL-Need Cancel',           'Pending',        'Need Cancel',            '#FF6347', false, 'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, false, false, false, true,  null,        9),
  ((select id from companies where legacy_code = 'COMP001'), 'NP',    'TR-Need PO',               'Pending',        'Accepted',               '#008000', true,  'Show All',     array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], true,  true,  false, false, false, false, 'ACCEPTED',  10),
  ((select id from companies where legacy_code = 'COMP001'), 'NS',    'CSR-Needs Scheduling',     'Pending',        'Accepted',               '#008080', false, 'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], true,  true,  false, false, false, true,  'ACCEPTED',  11),
  ((select id from companies where legacy_code = 'COMP001'), 'NT',    'TR-Need Triage',           'Pending',        'Accepted',               '#808080', false, 'Show All',     array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], true,  true,  false, false, false, false, 'ACCEPTED',  12),
  ((select id from companies where legacy_code = 'COMP001'), 'RC',    'CL-Ready to Complete',     'Ready to Repair','Confirmed',              '#A52A2A', true,  'Show All',     array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, false, true,  false, false, null,        13),
  ((select id from companies where legacy_code = 'COMP001'), 'RDCN',  'Redo Cancelled',           'Cancelled',      'Cancelled',              '#00FF00', false, 'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, true,  false, false, true,  null,        14),
  ((select id from companies where legacy_code = 'COMP001'), 'RF',    'OP-Reschedule Follow up',  'Pending',        'Accepted',               '#EE82EE', false, 'Show All',     array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], true,  true,  false, false, false, false, 'ACCEPTED',  15),
  ((select id from companies where legacy_code = 'COMP001'), 'ST010', 'CSR-Assigned to ASC',      'Pending',        'Accepted',               '#000000', false, 'Do not show', array['ADMIN','CSR'],                              true,  true,  false, false, false, true,  'ACCEPTED',  16),
  ((select id from companies where legacy_code = 'COMP001'), 'ST015', 'CSR-Acknowledged',         'Pending',        'Accepted',               '#FA8072', false, 'Do not show', array['ADMIN','CSR'],                              true,  true,  false, false, false, true,  'ACCEPTED',  17),
  ((select id from companies where legacy_code = 'COMP001'), 'ST025', 'OP-Ready for Service',     'Ready to Repair','Appointment Confirmed',  '#0000FF', true,  'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, false, true,  false, false, 'ACCEPTED',  18),
  ((select id from companies where legacy_code = 'COMP001'), 'ST035', 'CL-Completed',             'Completed',      'Completed',              '#008000', true,  'Show All',     array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], false, false, false, true,  false, false, 'COMPLETED', 19),
  ((select id from companies where legacy_code = 'COMP001'), 'UH',    'OP-UPDATE HOLD',           'Ready to Repair','Appointment Confirmed',  '#00FF00', false, 'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], true,  true,  false, false, false, true,  'ACCEPTED',  20),
  ((select id from companies where legacy_code = 'COMP001'), 'WP',    'OP-Waiting for Part',      'Pending',        'Accepted',               '#FFA500', false, 'Do not show', array['ADMIN','CSR','PARTS_MANAGER','TECHNICIAN'], true,  true,  true,  false, false, false, 'ACCEPTED',  21)
on conflict (company_id, code) do nothing;
