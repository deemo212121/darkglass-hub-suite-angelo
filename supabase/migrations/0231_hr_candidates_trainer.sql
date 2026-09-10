-- Who's training this candidate — set from the same "Training" status
-- dialog (ReportHRDaily.tsx) that already collects the start/end dates,
-- same manual-picker convention as branch_manager_id/assigned_interviewer_id
-- (0225/0227): a plain nullable FK, no separate assignment table.
alter table hr_candidates add column if not exists trainer_id uuid references profiles(id) on delete set null;
