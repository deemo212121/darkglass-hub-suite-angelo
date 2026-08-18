-- =====================================================================
-- 0176 — Backfill existing auto-synced mileage_entries rows so their
-- address/contact_number/email reflect the TECHNICIAN who drove, not the
-- customer they drove to. syncMileageFromTickets (mileage.ts) used to
-- pull these three columns straight off the ticket's customer record —
-- fixed going forward, but that fix only affects tickets synced AFTER
-- it; this backfills every already-synced row still linked to a real
-- profile (profile_id is null for rows that never matched a technician
-- profile — nothing to backfill those from).
--
-- Address is built the same way getTechnicianContactInfoByIds (users.ts)
-- builds it client-side: address1, address2, "city, state", zip, joined
-- with ", " and skipping any blank part.
--
-- Run once in the Supabase SQL Editor, after 0175.
-- =====================================================================

update mileage_entries me
set
  address = coalesce(
    nullif(
      trim(both ', ' from
        concat_ws(', ',
          nullif(p.employee_info->>'address1', ''),
          nullif(p.employee_info->>'address2', ''),
          nullif(trim(both ', ' from concat_ws(', ', nullif(p.employee_info->>'city', ''), nullif(p.employee_info->>'state', ''))), ''),
          nullif(p.employee_info->>'zipCode', '')
        )
      ),
      ''
    ),
    '(no address on file)'
  ),
  contact_number = nullif(p.phone_number, ''),
  email = nullif(p.email, '')
from profiles p
where me.profile_id = p.id
  and me.source = 'auto';
