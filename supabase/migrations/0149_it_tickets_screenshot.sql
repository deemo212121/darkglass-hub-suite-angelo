-- =====================================================================
-- 0149 — Screenshot attachment on IT tickets
--
-- Lets an employee attach one screenshot when submitting an IT ticket
-- (it-tickets.tsx) so IT can see what error they're actually looking at,
-- instead of relying purely on the free-text description. Stored in
-- Firebase Storage (see uploadItTicketScreenshot in storage.ts), only the
-- download URL lives here — same convention as expense receipts.
--
-- Run once in the Supabase SQL Editor, after 0148.
-- =====================================================================

alter table it_tickets add column if not exists screenshot_url text;
