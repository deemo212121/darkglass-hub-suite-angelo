-- =====================================================================
-- 0074 — Ticket Alerts: internal/mobile-popup visibility + per-tech
-- dismissal tracking
--
-- ticket_alerts already existed since 0001_init.sql (RLS-enabled, part of
-- the shared tenant_tables loop) but was never actually used anywhere in
-- the app — the "Alert Message" feature on the ticket detail page was
-- 100% localStorage, so it never synced across browsers/devices at all.
--
-- This adds two flags so staff can choose where an alert shows:
--   show_internal — inline at the top of the desktop ticket page
--                   (matches today's only behavior, default true)
--   mobile_popup  — pops up for a technician the moment they open this
--                   ticket on the mobile app (new, default false)
--
-- ticket_alert_dismissals tracks, per (alert, technician), whether that
-- tech has already acknowledged a mobile_popup alert — same
-- one-row-per-(profile, thing) pointer shape as message_reads (the
-- Announcements/Messenger "read" tracking), so a NEW alert (or an alert
-- a different tech hasn't seen yet, e.g. after a redo reassignment)
-- still pops up correctly.
--
-- Run once in the Supabase SQL Editor, after 0073.
-- =====================================================================

alter table ticket_alerts add column if not exists show_internal boolean not null default true;
alter table ticket_alerts add column if not exists mobile_popup boolean not null default false;

create index if not exists idx_ticket_alerts_ticket
  on ticket_alerts (ticket_id, created_at);

create table if not exists ticket_alert_dismissals (
  id            uuid primary key default uuid_generate_v4(),
  company_id    uuid not null references companies(id) on delete cascade,
  alert_id      uuid not null references ticket_alerts(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  dismissed_at  timestamptz not null default now(),
  unique (alert_id, profile_id)
);

create index if not exists idx_ticket_alert_dismissals_profile
  on ticket_alert_dismissals (profile_id, alert_id);

-- ---------- Auto-stamp company_id (same shared trigger every tenant table uses) ----------
drop trigger if exists trg_ticket_alert_dismissals_company on ticket_alert_dismissals;
create trigger trg_ticket_alert_dismissals_company
  before insert on ticket_alert_dismissals
  for each row execute function set_company_id();

-- ---------- RLS: company-scoped, matches ticket_alerts / ticket_comments pattern ----------
alter table ticket_alert_dismissals enable row level security;
alter table ticket_alert_dismissals force row level security;

drop policy if exists ticket_alert_dismissals_select on ticket_alert_dismissals;
create policy ticket_alert_dismissals_select on ticket_alert_dismissals
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_alert_dismissals_insert on ticket_alert_dismissals;
create policy ticket_alert_dismissals_insert on ticket_alert_dismissals
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists ticket_alert_dismissals_delete on ticket_alert_dismissals;
create policy ticket_alert_dismissals_delete on ticket_alert_dismissals
  for delete using (company_id = auth_company_id() or is_superadmin());
