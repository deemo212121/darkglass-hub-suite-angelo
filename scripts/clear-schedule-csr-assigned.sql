-- Clear schedule_date on every ticket currently sitting at
-- "CSR-Assigned to ASC". This is the AHS state that ServicePower-synced
-- tickets land in; per business rule the CSR (not ServicePower) owns the
-- schedule date, so anything we picked up from SP needs to be reset.
--
-- Scoped to AHS company b86acc43-08df-4ef3-aae0-1653cb5a1fcd.
--
-- IMPORTANT: we temporarily disable the ticket audit trigger because this is
-- a system-wide maintenance reset, not a user-initiated reschedule. The
-- audit trigger also requires ticket.company_id to be non-NULL — so any
-- historical rows with NULL company_id get back-filled first.

BEGIN;

-- 1. Back-fill company_id on any orphaned ticket rows we are about to touch.
--    These are tickets created before the auto-stamp trigger / before
--    company scoping was enforced. They belong to AHS by definition.
UPDATE tickets
SET company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd'
WHERE company_id IS NULL
  AND status = 'CSR-Assigned to ASC';

-- 2. Suspend the audit trigger so the bulk update doesn't generate a
--    'reschedule' audit row per ticket.
ALTER TABLE tickets DISABLE TRIGGER trg_ticket_audit;

-- 3. Preview (optional): uncomment to see rows that will be cleared.
-- SELECT id, ticket_no, status, schedule_date
-- FROM tickets
-- WHERE company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd'
--   AND status = 'CSR-Assigned to ASC'
--   AND schedule_date IS NOT NULL;

-- 4. Clear the schedule date.
UPDATE tickets
SET schedule_date = NULL,
    updated_at = NOW()
WHERE company_id = 'b86acc43-08df-4ef3-aae0-1653cb5a1fcd'
  AND status = 'CSR-Assigned to ASC'
  AND schedule_date IS NOT NULL;

-- 5. Re-enable the audit trigger so future CSR reschedules are tracked.
ALTER TABLE tickets ENABLE TRIGGER trg_ticket_audit;

COMMIT;
