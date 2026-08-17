-- =====================================================================
-- 0172 — Remember recent Drop-Ship Request recipients per company.
--
-- The ticket page's Part Transaction "Send"/"Send Selected" drop-ship
-- email (see gmailBridge.ts's send-dropship-request action) used to make
-- HR retype the distributor's Recipient/CC every time. This stores the
-- last-used address+CCs PER RECIPIENT (not just the single most recent
-- send overall — different POs go to different distributors, e.g. Meta
-- vs another vendor), shared company-wide like hr_activity_log, so
-- whoever sends next sees the same recent list regardless of who sent
-- to that distributor last.
--
-- Not sensitive (just email addresses HR already types into a form), so
-- plain company-scoped RLS like hr_activity_log rather than the
-- service-role-only lockdown used for hr_gmail_connections' refresh
-- tokens.
--
-- Run once in the Supabase SQL Editor, after 0171.
-- =====================================================================

create table if not exists hr_dropship_recipients (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  to_email      text not null,
  cc_emails     text[] not null default '{}',
  last_used_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (company_id, to_email)
);
create index if not exists idx_hr_dropship_recipients_company on hr_dropship_recipients(company_id, last_used_at desc);

alter table hr_dropship_recipients enable row level security;
alter table hr_dropship_recipients force row level security;

drop policy if exists hr_dropship_recipients_select on hr_dropship_recipients;
create policy hr_dropship_recipients_select on hr_dropship_recipients
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_dropship_recipients_insert on hr_dropship_recipients;
create policy hr_dropship_recipients_insert on hr_dropship_recipients
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists hr_dropship_recipients_update on hr_dropship_recipients;
create policy hr_dropship_recipients_update on hr_dropship_recipients
  for update using (company_id = auth_company_id() or is_superadmin())
  with check (company_id = auth_company_id() or is_superadmin());
