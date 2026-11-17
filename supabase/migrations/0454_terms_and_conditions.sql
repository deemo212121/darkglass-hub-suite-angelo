-- =====================================================================
-- 0454 — Terms & Conditions (Admin → Terms & Conditions).
--
-- Admins write terms as a DRAFT (nobody sees it), then press Publish to
-- make it live. Each set of terms says who it's for: Everyone, or any mix
-- of roles / departments / branches (a person matches if any one fits).
-- Signed-in people get a window they can't close until they accept;
-- each person accepts each set ONCE — again only when a new version is
-- published with "everyone must accept again".
--
--   terms_documents    a set of terms + its draft (title, text, who it's for)
--   terms_versions     what was published — never changed afterwards,
--                      so it's always clear what someone agreed to
--   terms_acceptances  who accepted which version, and when
--
-- Access:
--   write drafts / publish   : Admin, Super Admin
--   see drafts + who accepted: the same, plus HR (read only)
--   published versions       : everyone in the company (to read what they accept)
--   acceptances              : your own, through terms_accept() only
--
-- Functions: terms_publish(), terms_accept(), terms_pending_for_me().
-- New tables and functions only — nothing else is changed.
-- Safe to run again. Run once in the Supabase SQL Editor, after 0453.
-- =====================================================================

create or replace function terms_can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or is_company_superadmin() or is_superadmin();
$$;

create or replace function terms_can_view_all()
returns boolean language sql stable security definer set search_path = public as $$
  select terms_can_edit() or is_hr();
$$;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists terms_documents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  -- The draft: what Publish copies into a new version.
  title           text not null default '',
  body            text not null default '',
  -- { "everyone": true } or { "everyone": false, "roles": [...], "departments": [...], "branches": [...] }
  audience        jsonb not null default '{"everyone": true}'::jsonb,
  -- Stop asking for this set (already-given acceptances are kept).
  archived        boolean not null default false,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_by_name text,
  updated_at      timestamptz not null default now()
);
create index if not exists idx_terms_documents_company on terms_documents(company_id);

create table if not exists terms_versions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  document_id        uuid not null references terms_documents(id) on delete cascade,
  version            integer not null check (version >= 1),
  title              text not null,
  body               text not null,
  audience           jsonb not null,
  -- true = everyone must accept this version (always true for version 1);
  -- false = a small fix — people who accepted an earlier version aren't asked again.
  requires_reaccept  boolean not null default true,
  published_at       timestamptz not null default now(),
  published_by       uuid references profiles(id) on delete set null,
  published_by_name  text,
  unique (document_id, version)
);
create index if not exists idx_terms_versions_document on terms_versions(document_id, version desc);

create table if not exists terms_acceptances (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  document_id   uuid not null references terms_documents(id) on delete cascade,
  version_id    uuid not null references terms_versions(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  -- The name at the time (kept if the profile is renamed later).
  display_name  text,
  -- "web" or "mobile"
  device        text not null default 'web',
  accepted_at   timestamptz not null default now(),
  unique (version_id, profile_id)
);
create index if not exists idx_terms_acceptances_profile on terms_acceptances(profile_id);
create index if not exists idx_terms_acceptances_document on terms_acceptances(document_id);

-- Draft stamps (company and who changed it — from the signed-in profile, not the page).
create or replace function terms_documents_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id());
begin
  if tg_op = 'INSERT' then
    new.company_id := auth_company_id();
    new.created_by_name := v_name;
    new.created_at := now();
  else
    new.company_id := old.company_id;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
  end if;
  new.updated_by_name := v_name;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_terms_documents_stamp on terms_documents;
create trigger trg_terms_documents_stamp before insert or update on terms_documents
  for each row execute function terms_documents_stamp();

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table terms_documents enable row level security;
alter table terms_versions enable row level security;
alter table terms_acceptances enable row level security;

drop policy if exists terms_documents_select on terms_documents;
create policy terms_documents_select on terms_documents
  for select using (company_id = auth_company_id() and terms_can_view_all());

drop policy if exists terms_documents_insert on terms_documents;
create policy terms_documents_insert on terms_documents
  for insert with check (terms_can_edit());

drop policy if exists terms_documents_update on terms_documents;
create policy terms_documents_update on terms_documents
  for update using (company_id = auth_company_id() and terms_can_edit())
  with check (company_id = auth_company_id() and terms_can_edit());

-- Deleting a set also deletes its versions and acceptances — only a set never published can be deleted (the page checks too).
drop policy if exists terms_documents_delete on terms_documents;
create policy terms_documents_delete on terms_documents
  for delete using (
    company_id = auth_company_id() and terms_can_edit()
    and not exists (select 1 from terms_versions v where v.document_id = terms_documents.id)
  );

-- Published versions: anyone in the company can read them. No insert / update / delete
-- policy — only terms_publish() adds them, and nothing changes them.
drop policy if exists terms_versions_select on terms_versions;
create policy terms_versions_select on terms_versions
  for select using (company_id = auth_company_id());

-- Acceptances: your own, or everyone's for Admin / Super Admin / HR. Added only by terms_accept().
drop policy if exists terms_acceptances_select on terms_acceptances;
create policy terms_acceptances_select on terms_acceptances
  for select using (company_id = auth_company_id() and (profile_id = auth_profile_id() or terms_can_view_all()));

-- ---------------------------------------------------------------------
-- Who a set of terms is for (same rule as lib/terms.ts audienceMatches)
-- ---------------------------------------------------------------------
create or replace function terms_audience_matches(p_audience jsonb, p_role text, p_extra_roles text[], p_department text, p_branch text)
returns boolean language sql immutable as $$
  select
    coalesce((p_audience->>'everyone')::boolean, false)
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(p_audience->'roles', '[]'::jsonb)) r(v)
      where upper(btrim(r.v)) = upper(btrim(coalesce(p_role, '')))
         or upper(btrim(r.v)) = any (select upper(btrim(x)) from unnest(coalesce(p_extra_roles, '{}'::text[])) x)
    )
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(p_audience->'departments', '[]'::jsonb)) d(v)
      where lower(btrim(d.v)) = lower(btrim(coalesce(p_department, '')))
    )
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(p_audience->'branches', '[]'::jsonb)) b(v)
      where lower(regexp_replace(b.v, '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(coalesce(p_branch, ''), '[^a-zA-Z0-9]', '', 'g'))
        and coalesce(p_branch, '') <> ''
    );
$$;

-- ---------------------------------------------------------------------
-- Publish: the draft becomes the next version (Admin / Super Admin).
-- ---------------------------------------------------------------------
create or replace function terms_publish(p_document_id uuid, p_requires_reaccept boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_doc terms_documents;
  v_next integer;
  v_id uuid;
begin
  if not terms_can_edit() then
    raise exception 'Only Admin or Super Admin can publish terms.';
  end if;
  select * into v_doc from terms_documents where id = p_document_id and company_id = auth_company_id();
  if not found then
    raise exception 'Terms not found.';
  end if;
  if btrim(v_doc.title) = '' or btrim(regexp_replace(v_doc.body, '<[^>]*>', '', 'g')) = '' then
    raise exception 'Add a title and the terms text before publishing.';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from terms_versions where document_id = p_document_id;
  insert into terms_versions (company_id, document_id, version, title, body, audience, requires_reaccept, published_by, published_by_name)
  values (
    v_doc.company_id, v_doc.id, v_next, v_doc.title, v_doc.body, v_doc.audience,
    v_next = 1 or coalesce(p_requires_reaccept, true),
    auth_profile_id(),
    (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = auth_profile_id())
  )
  returning id into v_id;
  -- Publishing a stopped set starts asking again.
  update terms_documents set archived = false where id = v_doc.id and archived;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- What the signed-in person still has to accept: for each live set that
-- is for them, its latest version — unless they accepted it, or accepted
-- an earlier version and nothing since needs everyone to accept again.
-- ---------------------------------------------------------------------
create or replace function terms_pending_for_me()
returns table (version_id uuid, document_id uuid, version integer, title text, body text, published_at timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (
    select id, company_id, role, extra_roles, department, assigned_branch
    from profiles
    where id = auth_profile_id() and coalesce(is_active, true)
  ),
  latest as (
    select distinct on (v.document_id) v.*
    from terms_versions v
    join terms_documents d on d.id = v.document_id and not d.archived
    join me on me.company_id = v.company_id
    order by v.document_id, v.version desc
  ),
  must_have as (
    -- The newest version that everyone had to accept again, per set.
    select v.document_id, max(v.version) as version
    from terms_versions v join latest l on l.document_id = v.document_id
    where v.requires_reaccept
    group by v.document_id
  )
  select l.id, l.document_id, l.version, l.title, l.body, l.published_at
  from latest l
  join me on true
  join must_have m on m.document_id = l.document_id
  where terms_audience_matches(l.audience, me.role::text, me.extra_roles::text[], me.department, me.assigned_branch)
    and not exists (
      select 1 from terms_acceptances a
      join terms_versions av on av.id = a.version_id
      where a.profile_id = me.id and a.document_id = l.document_id and av.version >= m.version
    )
  order by l.published_at;
$$;

-- ---------------------------------------------------------------------
-- Accept: records the signed-in person's acceptance (once per version).
-- ---------------------------------------------------------------------
create or replace function terms_accept(p_version_id uuid, p_device text default 'web')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ver terms_versions;
  v_me uuid := auth_profile_id();
begin
  if v_me is null then
    raise exception 'Not signed in.';
  end if;
  select * into v_ver from terms_versions where id = p_version_id and company_id = auth_company_id();
  if not found then
    raise exception 'Terms not found.';
  end if;
  insert into terms_acceptances (company_id, document_id, version_id, profile_id, display_name, device)
  values (
    v_ver.company_id, v_ver.document_id, v_ver.id, v_me,
    (select coalesce(nullif(btrim(display_name), ''), email) from profiles where id = v_me),
    case when p_device = 'mobile' then 'mobile' else 'web' end
  )
  on conflict (version_id, profile_id) do nothing;
end;
$$;

grant execute on function terms_publish(uuid, boolean) to authenticated;
grant execute on function terms_pending_for_me() to authenticated;
grant execute on function terms_accept(uuid, text) to authenticated;

notify pgrst, 'reload schema';
