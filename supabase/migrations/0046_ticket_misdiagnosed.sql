-- =====================================================================
-- 0046 — Ticket misdiagnosed flag
--
-- Lets a manager-tier reviewer (BizOps, Manager, Admin, Triage Manager,
-- Claims Manager — enforced client-side in ticket.$ticketNo.tsx) flag a
-- ticket as having been misdiagnosed by the technician, which is why the
-- repair took longer than expected. Who set/unset it and when is already
-- captured by the existing ticket_audit_log (see logTicketAuditEntry) —
-- this column just holds the current state.
-- =====================================================================

alter table tickets add column if not exists misdiagnosed boolean not null default false;
