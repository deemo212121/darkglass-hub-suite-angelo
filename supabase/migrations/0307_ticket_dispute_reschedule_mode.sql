-- Ticket Time Dispute now supports two submission modes: the original
-- "time_dispute" (a failed on-site check-in the SAME day — the technician
-- was there, the app just didn't log it, so approval fills in the missing
-- onsite_arrived_at/onsite_done_at hours) and a new "reschedule" (the ticket
-- couldn't be done on its originally scheduled day at all and had to be
-- moved — the technician reports the day it was actually completed on
-- instead of a start/end time). See TicketDisputeSignModals.tsx /
-- TicketTimeDisputesTab.tsx's existing disputedStartTime/disputedEndTime
-- null-guard around setTicketOnsiteCheckIn — a reschedule row intentionally
-- leaves those two columns null, so approving one is a no-op on the ticket
-- itself until a reschedule-specific approval effect is built.
alter table employee_requests add column if not exists dispute_mode text not null default 'time_dispute'
  check (dispute_mode in ('time_dispute', 'reschedule'));
alter table employee_requests add column if not exists reschedule_actual_day date;
alter table employee_requests add column if not exists reschedule_date date;
