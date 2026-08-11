-- =====================================================================
-- 0137 — Private, membership-restricted channels
--
-- channel_members (0001_init.sql) already existed but was completely
-- unused — no app code wrote to it, and RLS on message_channels/messages
-- was purely company-scoped, so every channel was already visible to
-- every employee regardless of membership. This finally puts it to work,
-- but ONLY for newly-created channels: is_private defaults to false, so
-- every existing channel (the seeded #announcements/#general/etc., and
-- any company's already-created channels) keeps exactly its current
-- "open to the whole company" behavior — nothing already live changes.
--
-- New channels created via TeamMessenger.tsx's "Create Channel" (Admin/
-- SuperAdmin only) are is_private = true: visible/postable only to
-- channel_members rows, the creator, and Admin/SuperAdmin (who can see
-- and manage every channel for oversight). Admin/SuperAdmin are also the
-- only ones who can create a channel or add/remove members, except a
-- member can always remove themselves (leave).
--
-- DM messages (channel_id is null) are untouched by any of this — same
-- company-wide RLS they already had.
--
-- Run once in the Supabase SQL Editor, after 0136.
-- =====================================================================

alter table message_channels add column if not exists is_private boolean not null default false;

-- Parallels is_admin()/is_company_superadmin() (0089/0099) — whether the
-- caller can create channels, add/remove members, and see every private
-- channel regardless of their own membership.
create or replace function can_manage_channels()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or is_company_superadmin() or is_superadmin();
$$;

-- Whether the caller can read/post in a specific private channel: a
-- channel admin, that channel's creator, or an added member.
create or replace function can_access_private_channel(target_channel_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    can_manage_channels()
    or exists (
      select 1 from message_channels mc
      where mc.id = target_channel_id and mc.created_by = auth_profile_id()
    )
    or exists (
      select 1 from channel_members cm
      where cm.channel_id = target_channel_id and cm.profile_id = auth_profile_id()
    );
$$;

-- ---------- message_channels ----------
drop policy if exists message_channels_select on message_channels;
create policy message_channels_select on message_channels
  for select using (
    company_id = auth_company_id()
    and (is_private = false or can_access_private_channel(id))
  );

drop policy if exists message_channels_insert on message_channels;
create policy message_channels_insert on message_channels
  for insert with check (company_id = auth_company_id() and can_manage_channels());

drop policy if exists message_channels_update on message_channels;
create policy message_channels_update on message_channels
  for update using (
    company_id = auth_company_id() and (can_manage_channels() or created_by = auth_profile_id())
  )
  with check (
    company_id = auth_company_id() and (can_manage_channels() or created_by = auth_profile_id())
  );

drop policy if exists message_channels_delete on message_channels;
create policy message_channels_delete on message_channels
  for delete using (
    company_id = auth_company_id() and (can_manage_channels() or created_by = auth_profile_id())
  );

-- ---------- channel_members ----------
drop policy if exists channel_members_select on channel_members;
create policy channel_members_select on channel_members
  for select using (company_id = auth_company_id());

drop policy if exists channel_members_insert on channel_members;
create policy channel_members_insert on channel_members
  for insert with check (
    company_id = auth_company_id()
    and (
      can_manage_channels()
      or exists (select 1 from message_channels mc where mc.id = channel_id and mc.created_by = auth_profile_id())
    )
  );

drop policy if exists channel_members_update on channel_members;
create policy channel_members_update on channel_members
  for update using (company_id = auth_company_id() and can_manage_channels())
  with check (company_id = auth_company_id() and can_manage_channels());

drop policy if exists channel_members_delete on channel_members;
create policy channel_members_delete on channel_members
  for delete using (
    company_id = auth_company_id()
    and (
      can_manage_channels()
      or exists (select 1 from message_channels mc where mc.id = channel_id and mc.created_by = auth_profile_id())
      or profile_id = auth_profile_id()
    )
  );

-- ---------- messages ----------
-- Same shape as before (0100_platform_admin_data_lockdown.sql), just with
-- an added private-channel membership check ANDed onto both select and
-- insert. DM messages (channel_id is null) are unaffected.
drop policy if exists messages_select on messages;
create policy messages_select on messages
  for select using (
    company_id = auth_company_id()
    and (
      channel_id is null
      or not exists (select 1 from message_channels mc where mc.id = messages.channel_id and mc.is_private = true)
      or can_access_private_channel(messages.channel_id)
    )
  );

drop policy if exists messages_insert on messages;
create policy messages_insert on messages
  for insert with check (
    company_id = auth_company_id()
    and (
      is_announcement = false
      or exists (
        select 1 from profiles p
        where p.firebase_uid = current_setting('request.jwt.claims', true)::json->>'sub'
          and p.role in ('SUPERADMIN','ADMIN','MANAGER','HR')
      )
    )
    and (
      channel_id is null
      or not exists (select 1 from message_channels mc where mc.id = messages.channel_id and mc.is_private = true)
      or can_access_private_channel(messages.channel_id)
    )
  );
