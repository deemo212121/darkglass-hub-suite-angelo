-- =====================================================================
-- Add an editable problem description to tickets.
-- The ticket detail (General tab) can now edit + save this field.
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table tickets add column if not exists problem_description text;
