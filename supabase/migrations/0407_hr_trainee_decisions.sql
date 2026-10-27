-- =====================================================================
-- 0407 — Trainee decisions: the trainee's manager is asked "Hire, keep
-- training, or let go?" after 2 weeks of training and again on the last
-- training day (the day before Field Start). See src/lib/traineeDecision.ts.
--
-- One row per ask and per answer:
--   decision 'asked'   the hourly job asked the manager (notification sent)
--            'hire'    decision_date = Field Start (first day on their own)
--            'extend'  decision_date = new Field Start; asked again the day before
--            'let_go'  decision_date = last day; same as Training List's
--                      Quit/Stopped (withdrawn + account deactivated)
--   trainee_key  'candidate:<hr_candidates.id>' or 'profile:<profiles.id>'
--   due_date     the checkpoint the row belongs to (one ask per checkpoint)
--
-- Written only by the server (/api/trainee-decision and the hourly job,
-- service key) — the answer also changes hr_candidates / profiles, which a
-- Branch Manager can't edit themselves. Signed-in users of the company can
-- read it. New table only — no existing data is touched. Run once in the
-- Supabase SQL Editor, after 0406.
-- =====================================================================

create table if not exists hr_trainee_decisions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  trainee_key         text not null,
  candidate_id        uuid references hr_candidates(id) on delete cascade,
  profile_id          uuid references profiles(id) on delete set null,
  trainee_name        text not null,
  manager_profile_id  uuid references profiles(id) on delete set null,
  due_date            date not null,
  reason              text not null check (reason in ('two_weeks', 'training_end')),
  decision            text not null check (decision in ('asked', 'hire', 'extend', 'let_go')),
  decision_date       date,
  note                text,
  decided_by          uuid references profiles(id) on delete set null,
  decided_by_name     text,
  created_at          timestamptz not null default now(),
  unique (trainee_key, due_date, decision)
);

create index if not exists idx_hr_trainee_decisions_company on hr_trainee_decisions(company_id, created_at desc);

alter table hr_trainee_decisions enable row level security;

drop policy if exists hr_trainee_decisions_select on hr_trainee_decisions;
create policy hr_trainee_decisions_select on hr_trainee_decisions
  for select using (company_id = auth_company_id() or is_superadmin());
