-- =====================================================================
-- 0056 — Dedicated Case Number column
--
-- Case Number (New Ticket's manual entry field, and the NSA dispatch's
-- caseNumber) used to be stored in tickets.original_ticket_no — the same
-- column used for genuine "Redo Ticket #" references. That meant a ticket
-- could never have both at once, and the ticket detail page had to guess
-- which one a stored value actually meant (via the redo flag) rather than
-- just showing both independently. This gives Case Number its own column;
-- original_ticket_no goes back to meaning only "Redo Ticket #".
--
-- Existing rows are backfilled: any ticket whose original_ticket_no holds
-- what's actually a case number (i.e. redo = false, so that value was
-- never a genuine redo reference to begin with) gets it copied over here,
-- then cleared from original_ticket_no so it stops being mislabeled.
--
-- Run once in the Supabase SQL Editor, after 0055.
-- =====================================================================

alter table tickets add column if not exists case_number text;

update tickets
set case_number = original_ticket_no,
    original_ticket_no = null
where original_ticket_no is not null
  and original_ticket_no <> ''
  and redo = false;
