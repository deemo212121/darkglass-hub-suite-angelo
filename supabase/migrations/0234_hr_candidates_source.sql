-- Where the applicant was found — new dropdown on the Add Candidate form
-- (ReportHRDaily.tsx): Indeed / ZipRecruiter / Other (free text). Shown
-- under the Contact column rather than getting its own column. Free text
-- (not an enum) since "Other, please specify" needs to store whatever HR
-- actually types, same convention as department/position on this table.
alter table hr_candidates add column if not exists source text;
