-- Cancellation Reason gets its own column instead of being embedded as a
-- "Cancellation Reason: X" line inside Internal Note (the app used to parse
-- it back out of there — see src/lib/operationsBranchMetrics.ts). Backfills
-- from any existing embedded lines, then strips them out of Internal Note so
-- the same reason doesn't show up in both places.

alter table tickets add column if not exists cancellation_reason text;

-- Backfill: take the most recently appended "Cancellation Reason: X" line
-- per ticket (a ticket can accumulate more than one across visit saves).
update tickets t
set cancellation_reason = sub.reason
from (
  select t2.id, (array_agg(m[1]))[array_length(array_agg(m[1]), 1)] as reason
  from tickets t2, lateral regexp_matches(t2.internal_note, 'Cancellation Reason:\s*([^\n]+)', 'g') as m
  group by t2.id
) sub
where t.id = sub.id
  and t.cancellation_reason is null;

-- Strip the embedded lines out of Internal Note now that the reason lives
-- in its own column; collapse to NULL if nothing else was in the note.
update tickets
set internal_note = nullif(trim(both E'\n' from regexp_replace(internal_note, 'Cancellation Reason:[^\n]*\n?', '', 'g')), '')
where internal_note ~ 'Cancellation Reason:';
