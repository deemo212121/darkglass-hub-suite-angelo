-- ============================================================================
-- Create a test ticket assigned to "dummy.csr" (the profile with
-- role = CSR_MANAGER and TECHNICIAN as a secondary/extra_roles entry), so
-- the Mileage tab's auto-sync picks it up and you can test the On Hold
-- payroll-exclusion notification flow end-to-end.
--
-- This is ONE-OFF TEST DATA, not a schema migration — do not move this into
-- supabase/migrations/.
--
-- HOW TO USE
--   1. Open Supabase -> SQL Editor.
--   2. Run this whole file. It finds dummy.csr's profile automatically (no
--      UUID or exact display name needed) and upserts a customer + ticket.
--   3. Open Accounting -> Mileage tab (it auto-syncs on load). A row should
--      appear for dummy.csr on ticket DUMMY-CSR-TEST-01.
--   4. Click the On Hold toggle on that row and confirm -> this fires the
--      notification to dummy.csr (and their resolved manager, if
--      profiles.manager_name matches a real profile).
--
-- Safe to re-run: the ticket is upserted by (company_id, ticket_no), and the
-- test customer is reused instead of duplicated.
-- ============================================================================

do $$
declare
  v_profile record;
  v_customer_id uuid;
begin
  select id, company_id, display_name, assigned_branch
    into v_profile
    from profiles
    where role = 'CSR_MANAGER'
      and 'TECHNICIAN' = any(coalesce(extra_roles, '{}'))
    limit 1;

  if v_profile.id is null then
    raise exception 'No profile found with role = CSR_MANAGER and TECHNICIAN in extra_roles. Double-check dummy.csr''s role setup in User Management.';
  end if;

  if v_profile.display_name is null or trim(v_profile.display_name) = '' then
    raise exception 'Profile % has no display_name set — Mileage sync matches tickets to technicians by display_name, so this must be filled in first.', v_profile.id;
  end if;

  select id into v_customer_id
    from customers
    where company_id = v_profile.company_id
      and full_name = 'Dummy Test Customer'
    limit 1;

  if v_customer_id is null then
    insert into customers (company_id, first_name, last_name, full_name, phone, email, address, city, state, zip)
    values (
      v_profile.company_id,
      'Dummy', 'Test Customer', 'Dummy Test Customer',
      '555-010-0100', 'dummy.customer@example.com',
      '123 Test Street', 'Testville', 'CA', '90001'
    )
    returning id into v_customer_id;
  end if;

  insert into tickets (
    company_id, ticket_no, customer_id, location, technician,
    status, schedule_date, type
  )
  values (
    v_profile.company_id,
    'DUMMY-CSR-TEST-01',
    v_customer_id,
    coalesce(v_profile.assigned_branch, 'Main'),
    v_profile.display_name,
    'OP-Ready for Service',
    current_date,
    'Repair'
  )
  on conflict (company_id, ticket_no) do update
    set customer_id = excluded.customer_id,
        location = excluded.location,
        technician = excluded.technician,
        status = excluded.status,
        schedule_date = excluded.schedule_date,
        updated_at = now();

  raise notice 'Test ticket DUMMY-CSR-TEST-01 ready for profile % (display_name=%)', v_profile.id, v_profile.display_name;
end $$;
