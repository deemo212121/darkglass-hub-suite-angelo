-- =====================================================================
-- 0091 — Public "quick live chat" widget on the landing page
--
-- A landing-page visitor has no AHS account, so this is deliberately NOT
-- routed through Team Messenger (dm_threads/messages — see 0001_init.sql)
-- the way internal chat is. Instead:
--   - The visitor side is served by a public bridge (service-role key,
--     see src/lib/server/liveChatBridge.ts), same pattern as the external
--     signable-documents flow (0050/0076) — no anon RLS policy needed or
--     wanted, since these tables have no company-scoping the visitor could
--     safely be trusted with.
--   - The staff side (src/components/LiveChatSupportPage.tsx) reads/writes
--     directly via the authenticated Supabase client under normal RLS,
--     same as every other HR admin page.
--
-- The landing page is shared across every tenant with no way to know which
-- company a not-yet-logged-in visitor represents, so every visitor session
-- is stamped with whichever company is oldest (first ever created) — the
-- "primary" company this public site represents. See resolvePrimaryCompanyId()
-- in liveChatBridge.ts.
--
-- Run once in the Supabase SQL Editor, after 0090.
-- =====================================================================

create table if not exists live_chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  visitor_name    text,
  branch          text,
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at       timestamptz
);
create index if not exists idx_live_chat_sessions_company on live_chat_sessions(company_id, status, last_message_at desc);

create table if not exists live_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references live_chat_sessions(id) on delete cascade,
  sender          text not null check (sender in ('visitor', 'staff')),
  sender_name     text,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_live_chat_messages_session on live_chat_messages(session_id, created_at);

-- ---------- RLS ----------
-- Staff (any authenticated company member) can see and reply to their own
-- company's chats. There is deliberately no anon/public policy on either
-- table — a visitor never holds a Supabase session, so every visitor read
-- or write goes through the service-role bridge instead, which resolves
-- and checks company_id/session_id itself before touching the DB.
alter table live_chat_sessions enable row level security;
alter table live_chat_sessions force row level security;
alter table live_chat_messages enable row level security;
alter table live_chat_messages force row level security;

drop policy if exists live_chat_sessions_select on live_chat_sessions;
create policy live_chat_sessions_select on live_chat_sessions
  for select using (company_id = auth_company_id() or is_superadmin());

drop policy if exists live_chat_sessions_update on live_chat_sessions;
create policy live_chat_sessions_update on live_chat_sessions
  for update using (company_id = auth_company_id() or is_superadmin())
              with check (company_id = auth_company_id() or is_superadmin());

drop policy if exists live_chat_messages_select on live_chat_messages;
create policy live_chat_messages_select on live_chat_messages
  for select using (
    exists (
      select 1 from live_chat_sessions s
      where s.id = live_chat_messages.session_id
        and (s.company_id = auth_company_id() or is_superadmin())
    )
  );

drop policy if exists live_chat_messages_insert on live_chat_messages;
create policy live_chat_messages_insert on live_chat_messages
  for insert with check (
    sender = 'staff'
    and exists (
      select 1 from live_chat_sessions s
      where s.id = live_chat_messages.session_id
        and (s.company_id = auth_company_id() or is_superadmin())
    )
  );

-- ---------- Realtime ----------
-- Staff inbox subscribes to postgres_changes on both tables (see
-- subscribeTableChanges in src/lib/supabase/realtime.ts) — without this,
-- new sessions/messages only ever appear after a manual refresh.
do $$
begin
  alter publication supabase_realtime add table live_chat_sessions;
exception when duplicate_object then
  raise notice 'live_chat_sessions already in supabase_realtime publication';
end $$;

do $$
begin
  alter publication supabase_realtime add table live_chat_messages;
exception when duplicate_object then
  raise notice 'live_chat_messages already in supabase_realtime publication';
end $$;
