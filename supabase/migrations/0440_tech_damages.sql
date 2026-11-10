-- =====================================================================
-- 0440 — Tech Damages (Accounting module → Tech Damages).
--
-- One row per damage a technician caused: a house (customer property)
-- damage, a parts damage, or both. The same columns as Accounting's sheet:
--   Area · BM / SBM · Technician · Date · Ticket Number · Type
--   House Damage $ · Parts Damage $ · Total (house + parts)
--   Deduction per payroll · Cut-off date · Balance (total − deduction)
--   Status (ongoing / paid) · Notes · damage photos · signed waiver
-- Total and Balance are worked out by the database, so they can't be typed
-- wrong. The yearly House / Parts damage counts are counted on the page.
--
-- Access:
--   add / edit / delete / restore : Finance (Accounting), Admin, Super Admin
--   read only                     : HR
-- Delete only stamps deleted_at — the row stays and can be restored. Every
-- add / edit / delete / restore is written to tech_damage_events by trigger,
-- with what changed (e.g. "Deduction per payroll: $50.00 → $75.00").
--
-- Files: private bucket 'tech-damage-files', path
-- {company_id}/{damage_id}/{damage|waiver}-{time}_{name}; read through
-- short-lived signed links, same access as the rows.
--
-- New tables, functions and bucket only — nothing else is changed.
-- Safe to run again. Run once in the Supabase SQL Editor, after 0439.
-- =====================================================================

create or replace function tech_damages_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select is_finance() or is_admin() or is_company_superadmin() or is_superadmin();
$$;

create or replace function tech_damages_can_read()
returns boolean language sql stable security definer set search_path = public as $$
  select tech_damages_can_write() or is_hr();
$$;

create table if not exists tech_damages (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  area                   text not null default '',
  bm_sbm                 text not null default '',
  technician_profile_id  uuid references profiles(id) on delete set null,
  technician_name        text not null,
  damage_date            date not null default current_date,
  ticket_number          text not null default '',
  damage_type            text not null default '',
  house_damage           numeric(12,2) not null default 0 check (house_damage >= 0),
  parts_damage           numeric(12,2) not null default 0 check (parts_damage >= 0),
  total_amount           numeric(12,2) generated always as (house_damage + parts_damage) stored,
  deduction_per_payroll  numeric(12,2) not null default 0 check (deduction_per_payroll >= 0),
  cutoff_date            date,
  balance                numeric(12,2) generated always as (house_damage + parts_damage - deduction_per_payroll) stored,
  status                 text not null default 'ongoing' check (status in ('ongoing', 'paid')),
  notes                  text not null default '',
  -- [{ "path": "...", "name": "photo.jpg", "uploadedAt": "...", "uploadedBy": "..." }]
  damage_files           jsonb not null default '[]'::jsonb,
  waiver_files           jsonb not null default '[]'::jsonb,
  created_by             uuid references profiles(id) on delete set null,
  created_by_name        text,
  created_at             timestamptz not null default now(),
  updated_by_name        text,
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  deleted_by_name        text,
  check (btrim(technician_name) <> '')
);

-- The deduction per payroll can't be more than the total (balance never below $0).
alter table tech_damages drop constraint if exists tech_damages_deduction_within_total;
alter table tech_damages add constraint tech_damages_deduction_within_total
  check (deduction_per_payroll <= house_damage + parts_damage);

create index if not exists idx_tech_damages_company_date on tech_damages(company_id, damage_date desc);
create index if not exists idx_tech_damages_company_cutoff on tech_damages(company_id, cutoff_date);
create index if not exists idx_tech_damages_technician on tech_damages(technician_profile_id);

create table if not exists tech_damage_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  damage_id   uuid not null references tech_damages(id) on delete cascade,
  action      text not null check (action in ('created', 'edited', 'deleted', 'restored')),
  detail      text not null default '',
  actor_id    uuid references profiles(id) on delete set null,
  actor_name  text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tech_damage_events_damage on tech_damage_events(damage_id, created_at desc);
create index if not exists idx_tech_damage_events_company on tech_damage_events(company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Stamps: company and creator on add; who edited / deleted on change.
-- ---------------------------------------------------------------------
create or replace function tech_damages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
begin
  new.company_id := auth_company_id();
  new.created_by := v_me;
  new.created_by_name := (select display_name from profiles where id = v_me);
  new.created_at := now();
  new.updated_by_name := null;
  new.updated_at := now();
  new.deleted_at := null;
  new.deleted_by_name := null;
  new.technician_name := btrim(new.technician_name);
  return new;
end;
$$;

drop trigger if exists trg_tech_damages_before_insert on tech_damages;
create trigger trg_tech_damages_before_insert
  before insert on tech_damages
  for each row execute function tech_damages_before_insert();

create or replace function tech_damages_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select display_name from profiles where id = auth_profile_id());
begin
  new.id := old.id;
  new.company_id := old.company_id;
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;
  new.created_at := old.created_at;
  new.technician_name := btrim(new.technician_name);

  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is not null then
      new.deleted_at := now();
      new.deleted_by_name := v_name;
    else
      new.deleted_by_name := null;
    end if;
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception 'This damage is deleted — restore it first.';
  end if;
  new.deleted_by_name := old.deleted_by_name;
  new.updated_by_name := v_name;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tech_damages_before_update on tech_damages;
create trigger trg_tech_damages_before_update
  before update on tech_damages
  for each row execute function tech_damages_before_update();

-- ---------------------------------------------------------------------
-- History: every add / edit / delete / restore, with what changed.
-- ---------------------------------------------------------------------
create or replace function tech_damages_money(v numeric)
returns text language sql immutable as $$
  select '$' || to_char(coalesce(v, 0), 'FM999,999,990.00');
$$;

create or replace function tech_damages_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth_profile_id();
  v_name text := (select display_name from profiles where id = v_me);
  v_action text;
  v_changes text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_changes := array[new.technician_name || ' — ' || tech_damages_money(new.total_amount)];
  elsif new.deleted_at is distinct from old.deleted_at then
    v_action := case when new.deleted_at is null then 'restored' else 'deleted' end;
  else
    v_action := 'edited';
    if new.area is distinct from old.area then v_changes := v_changes || ('Area: ' || coalesce(nullif(old.area, ''), '—') || ' → ' || coalesce(nullif(new.area, ''), '—')); end if;
    if new.bm_sbm is distinct from old.bm_sbm then v_changes := v_changes || ('BM / SBM: ' || coalesce(nullif(old.bm_sbm, ''), '—') || ' → ' || coalesce(nullif(new.bm_sbm, ''), '—')); end if;
    if new.technician_name is distinct from old.technician_name then v_changes := v_changes || ('Technician: ' || old.technician_name || ' → ' || new.technician_name); end if;
    if new.damage_date is distinct from old.damage_date then v_changes := v_changes || ('Date: ' || to_char(old.damage_date, 'MM/DD/YYYY') || ' → ' || to_char(new.damage_date, 'MM/DD/YYYY')); end if;
    if new.ticket_number is distinct from old.ticket_number then v_changes := v_changes || ('Ticket: ' || coalesce(nullif(old.ticket_number, ''), '—') || ' → ' || coalesce(nullif(new.ticket_number, ''), '—')); end if;
    if new.damage_type is distinct from old.damage_type then v_changes := v_changes || ('Type: ' || coalesce(nullif(old.damage_type, ''), '—') || ' → ' || coalesce(nullif(new.damage_type, ''), '—')); end if;
    if new.house_damage is distinct from old.house_damage then v_changes := v_changes || ('House damage: ' || tech_damages_money(old.house_damage) || ' → ' || tech_damages_money(new.house_damage)); end if;
    if new.parts_damage is distinct from old.parts_damage then v_changes := v_changes || ('Parts damage: ' || tech_damages_money(old.parts_damage) || ' → ' || tech_damages_money(new.parts_damage)); end if;
    if new.deduction_per_payroll is distinct from old.deduction_per_payroll then v_changes := v_changes || ('Deduction per payroll: ' || tech_damages_money(old.deduction_per_payroll) || ' → ' || tech_damages_money(new.deduction_per_payroll)); end if;
    if new.cutoff_date is distinct from old.cutoff_date then v_changes := v_changes || ('Cut-off date: ' || coalesce(to_char(old.cutoff_date, 'MM/DD/YYYY'), '—') || ' → ' || coalesce(to_char(new.cutoff_date, 'MM/DD/YYYY'), '—')); end if;
    if new.status is distinct from old.status then v_changes := v_changes || ('Status: ' || initcap(old.status) || ' → ' || initcap(new.status)); end if;
    if new.notes is distinct from old.notes then v_changes := v_changes || 'Notes changed'::text; end if;
    if jsonb_array_length(new.damage_files) > jsonb_array_length(old.damage_files) then v_changes := v_changes || 'Damage attachment added'::text; end if;
    if jsonb_array_length(new.damage_files) < jsonb_array_length(old.damage_files) then v_changes := v_changes || 'Damage attachment removed'::text; end if;
    if jsonb_array_length(new.waiver_files) > jsonb_array_length(old.waiver_files) then v_changes := v_changes || 'Waiver attachment added'::text; end if;
    if jsonb_array_length(new.waiver_files) < jsonb_array_length(old.waiver_files) then v_changes := v_changes || 'Waiver attachment removed'::text; end if;
    if cardinality(v_changes) = 0 then return new; end if;
  end if;
  insert into tech_damage_events (company_id, damage_id, action, detail, actor_id, actor_name)
  values (new.company_id, new.id, v_action, array_to_string(v_changes, ' · '), v_me, v_name);
  return new;
end;
$$;

drop trigger if exists trg_tech_damages_after_write on tech_damages;
create trigger trg_tech_damages_after_write
  after insert or update on tech_damages
  for each row execute function tech_damages_after_write();

-- ---------------------------------------------------------------------
-- RLS. No delete policy: rows are only ever soft-deleted.
-- ---------------------------------------------------------------------
alter table tech_damages enable row level security;
alter table tech_damage_events enable row level security;

drop policy if exists tech_damages_select on tech_damages;
create policy tech_damages_select on tech_damages
  for select using (company_id = (select auth_company_id()) and (select tech_damages_can_read()));

drop policy if exists tech_damages_insert on tech_damages;
create policy tech_damages_insert on tech_damages
  for insert with check ((select tech_damages_can_write()));

drop policy if exists tech_damages_update on tech_damages;
create policy tech_damages_update on tech_damages
  for update using (company_id = (select auth_company_id()) and (select tech_damages_can_write()))
              with check (company_id = (select auth_company_id()) and (select tech_damages_can_write()));

drop policy if exists tech_damage_events_select on tech_damage_events;
create policy tech_damage_events_select on tech_damage_events
  for select using (company_id = (select auth_company_id()) and (select tech_damages_can_read()));

grant select, insert, update on tech_damages to authenticated;
grant select on tech_damage_events to authenticated;

-- ---------------------------------------------------------------------
-- Storage: damage photos and signed waivers.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tech-damage-files', 'tech-damage-files', false)
on conflict (id) do nothing;

drop policy if exists tech_damage_files_select on storage.objects;
create policy tech_damage_files_select on storage.objects
  for select using (
    bucket_id = 'tech-damage-files'
    and (storage.foldername(name))[1] = (auth_company_id())::text
    and tech_damages_can_read()
  );

drop policy if exists tech_damage_files_insert on storage.objects;
create policy tech_damage_files_insert on storage.objects
  for insert with check (
    bucket_id = 'tech-damage-files'
    and (storage.foldername(name))[1] = (auth_company_id())::text
    and tech_damages_can_write()
  );

drop policy if exists tech_damage_files_delete on storage.objects;
create policy tech_damage_files_delete on storage.objects
  for delete using (
    bucket_id = 'tech-damage-files'
    and (storage.foldername(name))[1] = (auth_company_id())::text
    and tech_damages_can_write()
  );
