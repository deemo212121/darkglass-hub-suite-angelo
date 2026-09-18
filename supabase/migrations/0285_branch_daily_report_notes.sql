-- =====================================================================
-- 0285 — Branch Daily Report notes become individual, per-author rows.
--
-- branch_daily_reports.notes (0284) was a single growing text field
-- everyone appended to — simple, but nobody could edit/delete just their
-- own line afterward. This splits notes out into their own table, one
-- row per note, so each note's actual author (author_id) can edit or
-- delete THEIR OWN note (see the update/delete policies below) — nobody
-- else can, not even a Senior Branch Manager or HR, except HR-and-above
-- may still delete any note for moderation.
--
-- branch_daily_reports.notes itself is left in place (unused going
-- forward, harmless) rather than dropped — any test notes already typed
-- into it stay there, just no longer rendered.
--
-- Run once in the Supabase SQL Editor, after 0284.
-- =====================================================================

create table if not exists branch_daily_report_notes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  report_id   uuid not null references branch_daily_reports(id) on delete cascade,
  -- Denormalized from the parent report row so RLS can check
  -- can_edit_branch_daily_report(branch) directly, no join needed.
  branch      text not null,
  author_id   uuid references profiles(id),
  author_name text not null,
  body        text not null,
  edited      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_branch_daily_report_notes_report on branch_daily_report_notes(report_id, created_at);
create index if not exists idx_branch_daily_report_notes_company on branch_daily_report_notes(company_id);

create or replace function branch_daily_report_notes_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    new.company_id := auth_company_id();
  end if;
  if new.author_id is null then
    new.author_id := auth_profile_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_branch_daily_report_notes_stamp on branch_daily_report_notes;
create trigger trg_branch_daily_report_notes_stamp before insert on branch_daily_report_notes
  for each row execute function branch_daily_report_notes_stamp();

-- ---------- RLS ----------
alter table branch_daily_report_notes enable row level security;
alter table branch_daily_report_notes force row level security;

drop policy if exists branch_daily_report_notes_select on branch_daily_report_notes;
create policy branch_daily_report_notes_select on branch_daily_report_notes
  for select using (company_id = auth_company_id() or is_superadmin());

-- Insert: same right as adding/editing the branch's report at all.
drop policy if exists branch_daily_report_notes_insert on branch_daily_report_notes;
create policy branch_daily_report_notes_insert on branch_daily_report_notes
  for insert with check (
    (company_id = auth_company_id() or is_superadmin())
    and can_edit_branch_daily_report(branch)
  );

-- Update: only the note's own author may edit it — not even a Senior
-- Branch Manager or HR can edit someone else's words.
drop policy if exists branch_daily_report_notes_update on branch_daily_report_notes;
create policy branch_daily_report_notes_update on branch_daily_report_notes
  for update using (
    (company_id = auth_company_id() or is_superadmin())
    and author_id = auth_profile_id()
  )
  with check (
    (company_id = auth_company_id() or is_superadmin())
    and author_id = auth_profile_id()
  );

-- Delete: the author, or HR-and-above for moderation.
drop policy if exists branch_daily_report_notes_delete on branch_daily_report_notes;
create policy branch_daily_report_notes_delete on branch_daily_report_notes
  for delete using (
    (company_id = auth_company_id() or is_superadmin())
    and (author_id = auth_profile_id() or is_hr() or is_admin() or is_company_superadmin() or is_superadmin())
  );
