-- =====================================================================
-- 0379 — Position Reassignment & Appointment Agreement (Chris Yong):
-- signing order. Chris signs first (his Employee part), then HR, then the
-- CEO (Justin Lee) last.
--
-- Sets config.signer.order on the form's two company headings (HR 1,
-- CEO 2 — see src/lib/customFormSections.ts): the CEO part only opens once
-- HR has signed; until then it shows "Justin Lee signs after HR." and Justin
-- gets no Complete button.
--
-- Changes this one form's field settings only — no submissions or other
-- forms are touched. Safe to run twice.
-- Run once in the Supabase SQL Editor, after 0378.
-- =====================================================================

update hr_custom_forms f
set fields = (
  select jsonb_agg(
    case
      when el->>'name' = 'hr_heading' and el #> '{config,signer}' is not null
        then jsonb_set(el, '{config,signer,order}', '1'::jsonb)
      when el->>'name' = 'company_heading' and el #> '{config,signer}' is not null
        then jsonb_set(el, '{config,signer,order}', '2'::jsonb)
      else el
    end
    order by ord
  )
  from jsonb_array_elements(f.fields) with ordinality as t(el, ord)
)
where f.id = '88ed6f6a-b4b6-447d-8e56-4227fae970c2';
