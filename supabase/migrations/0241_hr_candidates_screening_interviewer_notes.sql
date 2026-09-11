-- Two more free-text note fields on a candidate, alongside the existing
-- `notes` column (now labeled "HR Note" in the UI): a Screening Note and
-- an Interviewer Note, each independently editable in the Hiring table's
-- Note column.

alter table hr_candidates add column if not exists screening_note text;
alter table hr_candidates add column if not exists interviewer_note text;
