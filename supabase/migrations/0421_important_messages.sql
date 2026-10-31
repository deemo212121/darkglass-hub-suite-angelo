-- ============================================================================
-- 0421 — "Mark as important" on chat messages.
--
-- important_messages: one row per (message, person) — the messages a person
--   marked as important in the Team Messenger / floating messenger. Personal,
--   like a flag in email: you only ever see, add or remove your own marks.
--   You can only mark a message you can see (the messages RLS applies inside
--   the insert check), and a mark goes away with its message.
-- ============================================================================

create table if not exists important_messages (
  message_id  uuid not null references messages(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade default auth_profile_id(),
  created_at  timestamptz not null default now(),
  primary key (message_id, profile_id)
);
create index if not exists idx_important_messages_profile on important_messages(profile_id, created_at desc);

alter table important_messages enable row level security;

drop policy if exists important_messages_select on important_messages;
create policy important_messages_select on important_messages
  for select using (profile_id = auth_profile_id());

drop policy if exists important_messages_insert on important_messages;
create policy important_messages_insert on important_messages
  for insert with check (
    profile_id = auth_profile_id()
    and exists (select 1 from messages m where m.id = message_id)
  );

drop policy if exists important_messages_delete on important_messages;
create policy important_messages_delete on important_messages
  for delete using (profile_id = auth_profile_id());
