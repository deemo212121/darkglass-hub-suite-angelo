-- Manual "Screening Date" field on the Hiring table — independent of the
-- phone_screening status workflow (no date-required dialog like
-- Interview Date has); HR just picks a date whenever, same simple
-- click-to-edit pattern as Position.

alter table hr_candidates add column if not exists screening_date date;
