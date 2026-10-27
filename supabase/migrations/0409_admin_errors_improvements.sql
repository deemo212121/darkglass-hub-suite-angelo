-- =====================================================================
-- 0409 — Admin → Errors & Improvements (ErrorsImprovementsPage.tsx).
--
-- The running list of what needs doing: errors to fix, improvements,
-- to-dos. Each item keeps who added it (added_by / added_by_name) and, once
-- someone presses Confirm, who confirmed it and when (confirmed_by /
-- confirmed_by_name / confirmed_at — cleared again by Undo).
--
-- Admin / SuperAdmin of the company only, same as the Reports Library
-- (0371). New table, plus 15 starter items for US In Home Services
-- added under Jhon Norban Rulona — no existing data is touched. The starter
-- items are only inserted while the company has none, so running this again
-- doesn't duplicate them. Run once in the Supabase SQL Editor, after 0408.
-- =====================================================================

create table if not exists admin_errors_improvements (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  kind               text not null check (kind in ('error', 'improvement', 'todo')),
  area               text not null default '',
  title              text not null,
  details            text not null default '',
  added_by           uuid references profiles(id) on delete set null,
  added_by_name      text not null default '',
  confirmed_at       timestamptz,
  confirmed_by       uuid references profiles(id) on delete set null,
  confirmed_by_name  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_admin_errors_improvements_company on admin_errors_improvements(company_id, created_at);

alter table admin_errors_improvements enable row level security;

drop policy if exists admin_errors_improvements_select on admin_errors_improvements;
create policy admin_errors_improvements_select on admin_errors_improvements
  for select using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists admin_errors_improvements_insert on admin_errors_improvements;
create policy admin_errors_improvements_insert on admin_errors_improvements
  for insert with check (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists admin_errors_improvements_update on admin_errors_improvements;
create policy admin_errors_improvements_update on admin_errors_improvements
  for update using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()))
              with check (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));
drop policy if exists admin_errors_improvements_delete on admin_errors_improvements;
create policy admin_errors_improvements_delete on admin_errors_improvements
  for delete using (company_id = auth_company_id() and (is_admin() or is_company_superadmin()));

-- Starter items (2026-10-27), in list order.
insert into admin_errors_improvements (company_id, kind, area, title, details, added_by, added_by_name, created_at)
select 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd', v.kind, v.area, v.title, v.details,
       (select id from profiles where id = '78d3504c-56f9-43a0-b7b1-091e3eba7d36'), 'Jhon Norban Rulona',
       now() + make_interval(secs => v.n)
from (values
  (1, 'todo', 'Database (Supabase)', 'Run migration 0407_hr_trainee_decisions', 'Adds the table behind the trainee "Hire / Keep training / Let go" question. Until it runs, managers aren''t asked. No existing data changes.'),
  (2, 'todo', 'Database (Supabase)', 'Run migration 0408_er_backfill_import', 'Adds the ER backfill columns (tickets.er_backfill, tickets.cx_preferred_date, visits.er_backfill) and the fill-blanks import. Until it runs, ER history mode and "Past record from ER" can''t be saved. Run after 0407. No existing data changes.'),
  (3, 'todo', 'Deploy', 'Deploy the latest build', 'Not live yet: trainee decision prompt, No-Coverage Tickets and the ticket Out of Coverage banner, Flash Tech on User Management, the ER backfill import (janeyyy16), deactivated-name masking and the Warning Form 2nd/3rd rule (Angelo), the new-trainee notifications, the Staff Form Checklist default, PTO balance in PTO Requests, and this page.'),
  (4, 'improvement', 'HR → Training', 'Trainee decision: the first run asks about 17 trainees at once', 'Most are old Hiring records still at "training" weeks after Field Start (e.g. Rodrick Gordon, training since Aug 31). Alexxis Henry would be asked about 6, Matt Simmons 4, Kevin Khaiphanliane 3. Decide whether to skip anyone whose Field Start passed more than a week ago.'),
  (5, 'improvement', 'Deactivated names', 'Keep real names on the Training List and HR Dashboard?', 'Deactivated people show as "— (Deactivated User)" everywhere except Payroll, HR Paperworks, the signing pages, User Management and the Staff Form Checklist. On the Training List, 43 of the 49 Quit/Stopped people are masked; so are the HR Master List''s inactive employees and anyone let go through the trainee decision.'),
  (6, 'improvement', 'Tickets → Out of coverage', 'Only managers can schedule an out-of-coverage ticket?', 'USAPP shows "Only manager can set schedule" on out-of-coverage tickets. AHS shows the Out of Coverage banner but doesn''t restrict scheduling.'),
  (7, 'improvement', 'ServicePower sync', 'Bring uncovered ServicePower calls into AHS?', 'Ticket List''s automatic ServicePower pull skips calls whose ZIP isn''t covered, so they never reach No-Coverage Tickets (e.g. USAPP''s 732657).'),
  (8, 'improvement', 'Claims → Data Close', 'Data Close checklist: is the credit item required or a warning?', 'There''s no Data Close checklist in AHS yet, and the hourly ServicePower auto Data-Close is off for every company. Decide whether a missing Marcone / Encompass credit blocks Data Close or only warns.'),
  (9, 'improvement', 'Parts → Credits', 'Check why only 1 of 41 Marcone parts shows a credit', 'Credits sync from Marcone return authorizations, matched by invoice + part number. Encompass credits are still turned off.'),
  (10, 'improvement', 'HR notifications', 'New PH trainee notice: narrow who gets it?', 'It goes to all 9 accounts with HR as main or extra role, including the test account hr.testing and two IT / SuperAdmin accounts.'),
  (11, 'error', 'HR → Flash Tech', 'Matt Simmons''s Tallahassee trip is still set to Open', 'The trip ended Sep 20 but its status was set to Open by hand, so it still shows on User Management and still gives him Tallahassee access. Set it to Closed in the Flash Tech Tracker. Jonathan Knox''s old St. Louis trip (ended Oct 9) is set the same way; his newer St. Louis trip runs to Nov 7.'),
  (12, 'error', 'HR → Warning Form', 'Sent warning forms missing earlier warnings', 'Previous Warning(s) Issued was frozen when these were sent: Brye''shawn Butler (2nd and 3rd list none), Martwain Johnston (2nd), Marquese Hampton (2nd), LaShamus Dowell (3rd lists only one). Fix with Edit Previous Warnings on each sent form.'),
  (13, 'error', 'HR → Hiring', 'Hiring records stuck at "training"', 'Several candidates are still "training" weeks after Field Start although they work as Regular (e.g. David Morse, Field Start Sep 29; Rodrick Gordon, Sep 16; Keion West, Sep 17). The trainee decision will ask their managers once 0407 runs; HR can also mark them Hired.'),
  (14, 'error', 'Claims → ServicePower', 'Confirm the job code fix on a GE resubmit', 'The job code now goes in eiaRepairCode1 (Repair/Job Code); the claim-level jobCode was ignored (SA-5424453). Not confirmed until a clean GE resubmit.'),
  (15, 'todo', 'Carried over', 'Older open items to review', 'From earlier work, details in earlier sessions: repair category RPRCTG; the 21 reactivated HR-terminated accounts; Gene Patrick Pamintuan''s forms as AHS; claims 1008874278-10 and SA-5548150; the live-site rollback; the Login Security Unfreeze dialog; the Data Migration Re-pull bug; the /api/servicepower lockdown; batch 400401 / sequence 8402.')
) as v(n, kind, area, title, details)
where exists (select 1 from companies where id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd')
  and not exists (select 1 from admin_errors_improvements where company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd');
