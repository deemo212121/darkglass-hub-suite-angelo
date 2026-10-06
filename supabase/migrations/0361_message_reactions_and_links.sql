-- ============================================================================
-- 0361 — Chat reactions, replies and forwards.
--
-- message_reactions: one row per (message, person, emoji). Anyone in the
--   company can read them; you can only add or remove your own.
-- message_links: extra info about a message you sent — which message it
--   replies to, or where it was forwarded from. Kept in its own table so
--   the chat queries (which name the messages columns) are untouched.
-- Both are added to the realtime feed so other people see changes live.
-- ============================================================================

create table if not exists message_reactions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  message_id  uuid not null references messages(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade default auth_profile_id(),
  emoji       text not null check (length(emoji) between 1 and 16),
  created_at  timestamptz not null default now(),
  unique (message_id, profile_id, emoji)
);
create index if not exists idx_message_reactions_message on message_reactions(message_id);

drop trigger if exists trg_message_reactions_company on message_reactions;
create trigger trg_message_reactions_company
  before insert on message_reactions
  for each row execute function set_company_id();

alter table message_reactions enable row level security;

drop policy if exists message_reactions_select on message_reactions;
create policy message_reactions_select on message_reactions
  for select using (company_id = auth_company_id());

drop policy if exists message_reactions_insert on message_reactions;
create policy message_reactions_insert on message_reactions
  for insert with check (profile_id = auth_profile_id());

drop policy if exists message_reactions_delete on message_reactions;
create policy message_reactions_delete on message_reactions
  for delete using (profile_id = auth_profile_id());

create table if not exists message_links (
  message_id                 uuid primary key references messages(id) on delete cascade,
  company_id                 uuid not null references companies(id) on delete cascade,
  reply_to_id                uuid references messages(id) on delete set null,
  forwarded_from_message_id  uuid references messages(id) on delete set null,
  forwarded_from_name        text,
  created_at                 timestamptz not null default now()
);

drop trigger if exists trg_message_links_company on message_links;
create trigger trg_message_links_company
  before insert on message_links
  for each row execute function set_company_id();

alter table message_links enable row level security;

drop policy if exists message_links_select on message_links;
create policy message_links_select on message_links
  for select using (company_id = auth_company_id());

-- Only for a message you sent yourself.
drop policy if exists message_links_insert on message_links;
create policy message_links_insert on message_links
  for insert with check (
    exists (select 1 from messages m where m.id = message_id and m.sender_id = auth_profile_id())
  );

do $$
begin
  alter publication supabase_realtime add table message_reactions;
exception when duplicate_object then
  raise notice 'message_reactions already in supabase_realtime publication';
end $$;
