-- =====================================================================
-- 0378 — Position Reassignment & Appointment Agreement (Chris Yong, 0377):
-- each company part can only be signed by its own signer.
--
--   * COMPANY / EMPLOYER — only Justin Lee's account (CEO).
--   * HUMAN RESOURCES    — only HR-role accounts.
--
-- Sets config.signer on the form's two company headings (see
-- src/lib/customFormSections.ts). Everyone else opening Complete sees
-- "Waiting for Justin Lee / HR to sign." instead of that part's signature
-- pad. Chris signs his own (Employee) part on the form's link, as before.
--
-- Changes this one form's field settings only — no submissions or other
-- forms are touched. Safe to run twice.
-- Run once in the Supabase SQL Editor, after 0377.
-- =====================================================================

update hr_custom_forms f
set fields = (
  select jsonb_agg(
    case
      when el->>'name' = 'company_heading'
        then jsonb_set(el, '{config,signer}', '{"profileIds": ["6ee95872-1f1c-4a0e-95c3-4221a388ff14"], "name": "Justin Lee"}'::jsonb)
      when el->>'name' = 'hr_heading'
        then jsonb_set(el, '{config,signer}', '{"roles": ["HR"], "name": "HR"}'::jsonb)
      else el
    end
    order by ord
  )
  from jsonb_array_elements(f.fields) with ordinality as t(el, ord)
)
where f.id = '88ed6f6a-b4b6-447d-8e56-4227fae970c2';
