-- =====================================================================
-- 0035 — Notifications (bell icon)
--
-- A dedicated table for bell-icon alerts (e.g. "new employee request
-- submitted" pinging HR/Finance/Admin), separate from the internal
-- messenger's dm_threads/messages. Sending one here does NOT create or
-- touch a DM thread, so it never shows up in a recipient's Messages inbox
-- — only in the notification bell.
--
-- Run once in the Supabase SQL Editor.
-- =====================================================================

create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  recipient_id  uuid not null references profiles(id) on delete cascade,
  sender_id     uuid references profiles(id),
  sender_name   text,
  body          text not null,
  link_to       text,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_notifications_recipient on notifications(recipient_id, created_at desc);

-- ---------- Auto-stamp company_id (reuses set_company_id() from 0001_init.sql) ----------
drop trigger if exists trg_notifications_company on notifications;
create trigger trg_notifications_company
  before insert on notifications
  for each row execute function set_company_id();

-- ---------- RLS: recipients only see/manage their own notifications ----------
alter table notifications enable row level security;
alter table notifications force row level security;

drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications
  for select using (recipient_id = auth_profile_id() or is_superadmin());

drop policy if exists notifications_insert on notifications;
create policy notifications_insert on notifications
  for insert with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications
  for update using (recipient_id = auth_profile_id() or is_superadmin())
              with check (recipient_id = auth_profile_id() or is_superadmin());

drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications
  for delete using (recipient_id = auth_profile_id() or is_superadmin());
