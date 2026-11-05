-- =====================================================================
-- 0430 — Hiring emails: a list of signature photos to choose from
-- (0428 in Angelo's repo — renumbered here, after 0429_hiring_gmail_signature.)
--
-- Replaces 0429's one photo per Gmail account. HR, Admin and Super Admin
-- upload signatures here, and the Congratulatory / Status Update emails
-- have a dropdown to pick one, whichever Gmail the email is sent from:
--   - your own signatures, and
--   - any marked "shared with HR".
-- gmailBridge.ts enforces that on every send, Admins included, so nobody
-- can sign an email as a coworker.
--
-- Managing: you can share or remove your own, and an Admin / Super Admin
-- can share or remove anyone's. Only they see other people's private ones
-- listed, and only by name; the picture stays with its owner.
-- RLS is on with no policies, so only the server (service key) and the
-- functions below can touch this table.
--
-- Any photo saved under 0429 moves here as its owner's signature, then
-- that column and its functions are removed.
--
-- Safe to rerun. Run once in the Supabase SQL Editor, after 0429.
-- =====================================================================

create table if not exists hiring_email_signatures (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null,
  created_by_name text,
  name            text not null check (length(btrim(name)) between 1 and 80),
  image           text not null check (image ~ '^data:image/(png|jpeg|gif);base64,' and length(image) <= 1500000),
  shared          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_hiring_email_signatures_company on hiring_email_signatures(company_id);

alter table hiring_email_signatures enable row level security;
alter table hiring_email_signatures force row level security;

drop trigger if exists trg_hiring_email_signatures_touch on hiring_email_signatures;
create trigger trg_hiring_email_signatures_touch
  before update on hiring_email_signatures
  for each row execute function hr_gmail_connections_touch_updated_at();

-- Move 0429's photos over, then retire that column. Dynamic SQL because the
-- column is already gone if this file runs a second time.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'hiring_gmail_accounts' and column_name = 'signature_image'
  ) then
    execute $sql$
      insert into hiring_email_signatures (company_id, created_by, created_by_name, name, image, shared)
      select a.company_id, a.connected_by, a.connected_by_name,
             left(coalesce(nullif(btrim(a.connected_by_name), ''), a.connected_email), 80),
             a.signature_image, a.shared
      from hiring_gmail_accounts a
      where a.signature_image is not null
    $sql$;
    alter table hiring_gmail_accounts drop column signature_image;
  end if;
end;
$$;

drop function if exists get_hiring_gmail_signature(uuid);
drop function if exists set_hiring_gmail_signature(uuid, text);

-- Back to 0428's result columns, now the accounts have no photo.
drop function if exists get_hiring_gmail_accounts();
create function get_hiring_gmail_accounts()
returns table(
  id uuid,
  connected_email text,
  connected_account_name text,
  connected_by_name text,
  shared boolean,
  created_at timestamptz,
  mine boolean
)
language sql stable security definer set search_path = public as $$
  select
    a.id,
    a.connected_email,
    a.connected_account_name,
    a.connected_by_name,
    a.shared,
    a.created_at,
    coalesce(a.connected_by = c.profile_id, false)
  from hiring_gmail_accounts a
  join hiring_gmail_caller() c on c.company_id = a.company_id
  where c.can_use
  order by a.connected_email;
$$;

-- Names only, so the list stays small. Your own and shared ones; an Admin also
-- gets the rest, by name, so they can remove them.
create or replace function get_hiring_email_signatures()
returns table(
  id uuid,
  name text,
  created_by_name text,
  shared boolean,
  created_at timestamptz,
  mine boolean
)
language sql stable security definer set search_path = public as $$
  select
    s.id,
    s.name,
    s.created_by_name,
    s.shared,
    s.created_at,
    coalesce(s.created_by = c.profile_id, false)
  from hiring_email_signatures s
  join hiring_gmail_caller() c on c.company_id = s.company_id
  where c.can_use
    and (s.shared or s.created_by = c.profile_id or c.can_manage_all)
  order by s.name;
$$;

-- The picture itself: your own or a shared one, Admins included.
create or replace function get_hiring_email_signature_image(p_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select s.image
  from hiring_email_signatures s
  join hiring_gmail_caller() c on c.company_id = s.company_id
  where s.id = p_id
    and c.can_use
    and (s.shared or s.created_by = c.profile_id);
$$;

create or replace function add_hiring_email_signature(p_name text, p_image text, p_shared boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
  v_id uuid;
begin
  select * into v_caller from hiring_gmail_caller();
  if v_caller.company_id is null or not v_caller.can_use then
    raise exception 'You do not have permission to add a signature';
  end if;

  insert into hiring_email_signatures (company_id, created_by, created_by_name, name, image, shared)
  select v_caller.company_id, p.id, coalesce(p.display_name, p.username, p.email), btrim(p_name), p_image, coalesce(p_shared, false)
  from profiles p
  where p.id = v_caller.profile_id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function set_hiring_email_signature_shared(p_id uuid, p_shared boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
begin
  select * into v_caller from hiring_gmail_caller();
  if v_caller.company_id is null or not v_caller.can_use then
    raise exception 'You do not have permission to change this signature';
  end if;

  update hiring_email_signatures s
  set shared = p_shared
  where s.id = p_id
    and s.company_id = v_caller.company_id
    and (s.created_by = v_caller.profile_id or v_caller.can_manage_all);
  if not found then
    raise exception 'You can only share your own signature';
  end if;
end;
$$;

create or replace function delete_hiring_email_signature(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
begin
  select * into v_caller from hiring_gmail_caller();
  if v_caller.company_id is null or not v_caller.can_use then
    raise exception 'You do not have permission to remove this signature';
  end if;

  delete from hiring_email_signatures s
  where s.id = p_id
    and s.company_id = v_caller.company_id
    and (s.created_by = v_caller.profile_id or v_caller.can_manage_all);
  if not found then
    raise exception 'You can only remove your own signature';
  end if;
end;
$$;

notify pgrst, 'reload schema';
