-- =====================================================================
-- 0425 — Form Inconsistencies: "Mark as checked"
--
-- HR Paperworks → Form Inconsistencies (FormInconsistenciesPanel.tsx)
-- cross-checks each person's signed forms — name, SSN, date of birth,
-- address, phone, email, driver's license # — and lists where they
-- disagree (src/lib/formConsistency.ts). Some differences are fine (the
-- person moved), so HR can mark one as checked. A row here hides that
-- exact set of differing values; a new, different value shows it again.
--
-- values_key is a hash of the differing values (never the values
-- themselves). HR / Admin / Super Admin read and write every row; a
-- person can read their own (the check that runs when they sign a form
-- skips differences HR already checked).
--
-- New table only — no existing data is touched. Safe to rerun.
-- Run once in the Supabase SQL Editor, after 0424.
-- =====================================================================

create or replace function is_form_consistency_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select is_hr() or is_admin() or is_company_superadmin() or is_superadmin();
$$;

create table if not exists form_consistency_reviews (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  profile_id        uuid not null references profiles(id) on delete cascade,
  field             text not null,
  values_key        text not null,
  note              text,
  reviewed_by       uuid references profiles(id) on delete set null,
  reviewed_by_name  text,
  created_at        timestamptz not null default now(),
  constraint form_consistency_reviews_unique unique (company_id, profile_id, field, values_key)
);
create index if not exists idx_form_consistency_reviews_profile on form_consistency_reviews(company_id, profile_id);

create or replace function form_consistency_reviews_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.reviewed_by is null then
    new.reviewed_by := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_form_consistency_reviews_stamp on form_consistency_reviews;
create trigger trg_form_consistency_reviews_stamp before insert on form_consistency_reviews
  for each row execute function form_consistency_reviews_stamp();

alter table form_consistency_reviews enable row level security;
alter table form_consistency_reviews force row level security;

drop policy if exists form_consistency_reviews_select on form_consistency_reviews;
create policy form_consistency_reviews_select on form_consistency_reviews
  for select using (
    company_id = auth_company_id()
    and (is_form_consistency_reviewer() or profile_id = auth_profile_id())
  );

drop policy if exists form_consistency_reviews_insert on form_consistency_reviews;
create policy form_consistency_reviews_insert on form_consistency_reviews
  for insert with check (company_id = auth_company_id() and is_form_consistency_reviewer());

drop policy if exists form_consistency_reviews_delete on form_consistency_reviews;
create policy form_consistency_reviews_delete on form_consistency_reviews
  for delete using (company_id = auth_company_id() and is_form_consistency_reviewer());
