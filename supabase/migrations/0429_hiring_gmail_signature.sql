-- =====================================================================
-- 0429 — Hiring Gmail: signature photo
-- (0427 in Angelo's repo — renumbered here, after 0428_hiring_gmail_accounts.)
--
-- Gmail only adds someone's signature in its own compose window, not to
-- email sent through its API. So each connected Hiring Gmail can have a
-- signature photo here, and the Congratulatory / Status Update emails can
-- put it after the sign-off (gmailBridge.ts embeds it in the email).
--
-- The photo is saved on the account as a data: URL, at most about 1 MB,
-- so it goes when the account is disconnected. The account's owner or an
-- Admin / Super Admin can change it. Anyone who can send from the account
-- can see it, and the account list only says whether there is one.
--
-- One new column — no existing data is changed. Safe to rerun.
-- Run once in the Supabase SQL Editor, after 0428.
-- =====================================================================

alter table hiring_gmail_accounts add column if not exists signature_image text;

alter table hiring_gmail_accounts drop constraint if exists hiring_gmail_accounts_signature_image_check;
alter table hiring_gmail_accounts add constraint hiring_gmail_accounts_signature_image_check check (
  signature_image is null
  or (signature_image ~ '^data:image/(png|jpeg|gif);base64,' and length(signature_image) <= 1500000)
);

-- Adds has_signature. Its result columns change, so it has to be dropped first.
drop function if exists get_hiring_gmail_accounts();
create function get_hiring_gmail_accounts()
returns table(
  id uuid,
  connected_email text,
  connected_account_name text,
  connected_by_name text,
  shared boolean,
  created_at timestamptz,
  mine boolean,
  has_signature boolean
)
language sql stable security definer set search_path = public as $$
  select
    a.id,
    a.connected_email,
    a.connected_account_name,
    a.connected_by_name,
    a.shared,
    a.created_at,
    coalesce(a.connected_by = c.profile_id, false),
    a.signature_image is not null
  from hiring_gmail_accounts a
  join hiring_gmail_caller() c on c.company_id = a.company_id
  where c.can_use
  order by a.connected_email;
$$;

create or replace function get_hiring_gmail_signature(p_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select a.signature_image
  from hiring_gmail_accounts a
  join hiring_gmail_caller() c on c.company_id = a.company_id
  where a.id = p_id
    and c.can_use
    and (a.shared or a.connected_by = c.profile_id or c.can_manage_all);
$$;

-- p_image null removes the photo.
create or replace function set_hiring_gmail_signature(p_id uuid, p_image text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_caller record;
begin
  select * into v_caller from hiring_gmail_caller();
  if v_caller.company_id is null or not v_caller.can_use then
    raise exception 'You do not have permission to change this Gmail';
  end if;

  update hiring_gmail_accounts a
  set signature_image = p_image
  where a.id = p_id
    and a.company_id = v_caller.company_id
    and (a.connected_by = v_caller.profile_id or v_caller.can_manage_all);
  if not found then
    raise exception 'You can only change the signature photo on your own Gmail';
  end if;
end;
$$;

notify pgrst, 'reload schema';
