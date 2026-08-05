-- =====================================================================
-- 0130 — Link expenses to their originating Flash Tech trip
--
-- Scheduling a Flash Tech trip (0129_flash_tech_trips.sql) can create up
-- to two Pending expense rows against the traveling person — one for
-- Hotel, one for Transportation — created with amount defaulting to 0 and
-- no receipt, filled in later by whoever handles the actual receipt (see
-- FlashTechCalendarPage.tsx / ExpenseTrackingPage.tsx's existing edit
-- flow — no changes needed there, these are just ordinary `expenses` rows).
--
-- flash_tech_trip_id is `on delete set null` (not cascade) — removing a
-- trip must never delete a real financial record, just unlink it.
--
-- Run once in the Supabase SQL Editor, after 0129.
-- =====================================================================

alter table expenses add column if not exists flash_tech_trip_id uuid references flash_tech_trips(id) on delete set null;
-- 'hotel' | 'transportation' — only set on expenses created from a Flash
-- Tech trip; null for every ordinary employee-filed expense.
alter table expenses add column if not exists expense_subtype text;
create index if not exists idx_expenses_flash_tech_trip on expenses(flash_tech_trip_id);
