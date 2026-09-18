-- Per-day work state for a timecard entry (technicians travel between
-- states job to job, so this is independently editable per day rather than
-- an effective-dated value on the profile).
ALTER TABLE timecard_entries ADD COLUMN IF NOT EXISTS state text;
