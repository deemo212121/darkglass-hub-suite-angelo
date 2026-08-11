-- =====================================================================
-- 0164 — Backdated warnings/mistakes: employee_conduct_notes.occurred_at.
--
-- Lets HR log a warning that happened before this system existed (paper
-- form, verbal, etc.) with its real historical date, without lying about
-- created_at — created_at stays a true "when was this row entered"
-- audit field; occurred_at is "when the incident actually happened".
-- Null for every note entered the normal way (the two stay identical in
-- practice for those), only set on backfilled historical entries.
--
-- Run once in the Supabase SQL Editor, after 0163.
-- =====================================================================

alter table employee_conduct_notes add column if not exists occurred_at timestamptz;
