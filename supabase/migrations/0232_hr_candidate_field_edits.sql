-- Per-column "who last edited this" audit trail for the Hiring table's
-- inline-editable fields (Name/Position/Branch/Branch Manager/Assigned
-- Interviewer/Department/Contact/Note/Texted-Called) — mirrors what
-- hr_candidate_status_history already does for the Status column, but as
-- one generic log keyed by field name instead of a dedicated
-- status-transition table. Status itself (and Trainer, set alongside it)
-- keeps using that existing table — not duplicated here.

create table if not exists hr_candidate_field_edits (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  candidate_id uuid not null references hr_candidates(id) on delete cascade,
  field_name text not null,
  changed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_hr_candidate_field_edits_lookup on hr_candidate_field_edits(candidate_id, field_name, created_at desc);

-- Same simple company-scoped access every other hr_candidates-adjacent
-- table this session added already uses (see hr_candidate_required_forms,
-- 0224) — not narrowed to a specific role.
alter table hr_candidate_field_edits enable row level security;
alter table hr_candidate_field_edits force row level security;

create policy hr_candidate_field_edits_select on hr_candidate_field_edits
  for select using (company_id = auth_company_id() or is_superadmin());
create policy hr_candidate_field_edits_insert on hr_candidate_field_edits
  for insert with check (company_id = auth_company_id() or is_superadmin());

-- Auto-stamps company_id (from the parent candidate row) and changed_by
-- (from the calling user) so the client never has to pass either — same
-- auth_profile_id() convention hr_candidates.created_by already uses
-- (0042_hr_candidates.sql).
create or replace function hr_candidate_field_edits_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from hr_candidates where id = new.candidate_id;
  if new.changed_by is null then
    new.changed_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists hr_candidate_field_edits_stamp_trigger on hr_candidate_field_edits;
create trigger hr_candidate_field_edits_stamp_trigger
  before insert on hr_candidate_field_edits
  for each row execute function hr_candidate_field_edits_stamp();
