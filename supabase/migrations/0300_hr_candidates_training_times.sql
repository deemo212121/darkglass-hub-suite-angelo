-- Daily Time In / Time Out for a trainee (Training List page), separate
-- from training_start_date/training_end_date (which are the DATES a
-- trainee's training window opened/closed, not a clock time). Stored as
-- plain "HH:MM" text, same pragmatic choice as interview_time
-- (0232_hr_candidates_interview_time.sql) — always edited alongside the
-- training dates on the same row, never queried on its own.
--
-- Run once in the Supabase SQL Editor, after 0297_profiles_training_end_date.sql.

alter table hr_candidates add column if not exists training_time_in text;
alter table hr_candidates add column if not exists training_time_out text;
