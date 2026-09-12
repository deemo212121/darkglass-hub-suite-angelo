-- Retroactive cleanup for the reverted "auto-default HR Status to Absent"
-- feature (AbsentListPage.tsx) — it wrote hr_note = 'Absent' with
-- created_by left NULL specifically because nobody actually chose it, so
-- that's exactly what distinguishes a false auto-set absence from a real
-- one HR picked by hand (those always carry a created_by). Only clears the
-- auto-set ones; a genuine manual "Absent" is left untouched.

update attendance_notes
set hr_note = null
where hr_note = 'Absent' and created_by is null;
