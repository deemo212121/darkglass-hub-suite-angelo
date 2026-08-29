-- Index for the Ticket List's default access path.
--
-- getCompanyTickets() (src/lib/supabase/tickets.ts) — used by the Ticket
-- List, the CSR/Claims/Operations dashboards and every daily report —
-- pages the company's tickets ordered by created_at desc. The only
-- indexes on `tickets` were company_id, (company_id, status),
-- (company_id, schedule_date) and the unique (company_id, ticket_no);
-- none covers "this company's rows, newest first", so each open sorted
-- the whole company partition. At a few thousand rows per company that
-- sort was a visible slice of the ~1 min load.
--
-- The desc ordering on created_at matches the query so Postgres can walk
-- the index instead of sorting; id is appended as the tiebreaker the
-- paginated fetch now also orders by (created_at is not unique — a bulk
-- import gives many rows the same timestamp).

create index if not exists idx_tickets_company_created
  on tickets (company_id, created_at desc, id desc);
