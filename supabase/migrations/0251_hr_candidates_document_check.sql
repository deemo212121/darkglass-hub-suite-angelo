-- New Hiring table column: a single check/X toggle, manually set for now.
-- HR asked for this ahead of specifying which document it should actually
-- verify — once that's disclosed, the automatic detection logic can update
-- this same column instead of (or alongside) the manual toggle below.

alter table hr_candidates add column if not exists document_verified boolean not null default false;
