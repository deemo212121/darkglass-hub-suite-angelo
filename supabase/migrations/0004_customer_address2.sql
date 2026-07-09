-- =====================================================================
-- Add a second address line to customers.
-- The New Ticket form now collects Address and Address 2 (both required).
-- Run once in the Supabase SQL Editor.
-- =====================================================================

alter table customers add column if not exists address2 text;
