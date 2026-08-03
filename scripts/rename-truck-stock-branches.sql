-- =====================================================================
-- One-off: rename truck_stock.branch values from the spreadsheet's
-- short codes (AV, ATL, BM, …) to the full city names defined in
-- src/lib/locations.ts.
--
-- The rename has to deal with the (company_id, branch, part_no) unique
-- constraint — if both "AV" and "Asheville" rows exist for the same
-- part, we sum the quantities into the existing full-name row and
-- delete the short-code row before doing the rename.
--
-- Safe to re-run; nothing happens for short codes that aren't present.
-- =====================================================================
do $$
declare
  pair record;
  pairs constant text[][] := array[
    ['AV', 'Asheville'],
    ['ATL','Atlanta'],
    ['BM', 'Birmingham'],
    ['CT', 'Chattanooga'],
    ['LR', 'Little Rock'],
    ['MG', 'Montgomery'],
    ['NF', 'Norfolk'],
    ['RL', 'Raleigh'],
    ['RD', 'Richmond'],
    ['SV', 'Savannah'],
    ['TL', 'Tallahassee'],
    -- Best-guess (edit if any of these are wrong):
    ['CB', 'Columbus'],
    ['CG', 'Cape Girardeau'],
    ['DT', 'Destin'],
    ['DL', 'Dallas'],
    ['HV', 'Huntsville'],
    ['JS', 'Jacksonville'],
    ['JB', 'Jonesboro'],
    ['JT', 'Jackson, TN'],
    ['JV', 'Jacksonville'],
    ['KV', 'Knoxville'],
    ['LC', 'Lake Charles'],
    ['MB', 'Mobile'],
    ['MP', 'Memphis'],
    ['NO', 'New Orleans'],
    ['NV', 'Nashville'],
    ['SA', 'San Antonio'],
    ['SL', 'St. Louis'],
    ['WM', 'Wilmington']
  ];
  short_code text;
  full_name  text;
  i int;
begin
  for i in 1..array_length(pairs, 1) loop
    short_code := pairs[i][1];
    full_name  := pairs[i][2];

    -- 1. Fold duplicates: where the same part exists under both labels
    --    in the same company, add the short-code quantity onto the
    --    full-name row, then delete the short-code row so the rename
    --    in step 2 doesn't collide with the unique constraint.
    update truck_stock dst
       set quantity = dst.quantity + src.quantity,
           updated_at = now()
      from truck_stock src
     where src.company_id = dst.company_id
       and src.part_no    = dst.part_no
       and src.branch     = short_code
       and dst.branch     = full_name;

    delete from truck_stock
     where branch = short_code
       and (company_id, part_no) in (
         select company_id, part_no from truck_stock where branch = full_name
       );

    -- 2. Rename the survivors.
    update truck_stock set branch = full_name where branch = short_code;
  end loop;
end $$;
