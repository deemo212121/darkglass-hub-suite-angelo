-- Assigned Interviewer's "manager" slot (top line of that column) — a
-- separate, independently-pickable assignment from branch_manager_id (the
-- branch's actual manager). Defaults to showing the branch manager when
-- unset, but this manager is acting as an INTERVIEWER here, which can be a
-- different person than whoever manages the branch day-to-day.

alter table hr_candidates add column if not exists assigned_manager_id uuid references profiles(id);
