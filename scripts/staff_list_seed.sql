-- =====================================================================
-- Staff List reference data — Current Staff (branch-manager summary) and
-- Tier Level (pay-rate table), generated from "Staff List.xlsx". Run
-- once in the Supabase SQL Editor, AFTER migration 0162 (which drops
-- staff_list_roster — the per-person roster is now a live view of
-- Master List/profiles instead, see staff_list_backfill.sql for
-- carrying over the 4 Excel-only per-person fields it can't provide).
-- Safe to re-run: each block is gated behind "only if this company's
-- table is still empty".
-- =====================================================================

do $$
declare
  cid uuid;
begin
  select id into cid from companies where legacy_code = 'COMP001';
  if cid is null then
    return;
  end if;

  if not exists (select 1 from staff_list_current_staff where company_id = cid limit 1) then
    insert into staff_list_current_staff (company_id, branch, abbreviation, senior_branch_manager, branch_manager, technical_manager, part_manager, address, trash_company, phone, row_sort) values
    (cid, 'Asheville', 'AV', 'Matt Simmons', null, 'Jordan Koetsier', 'Johnathan Allen', '3869 Sweeten Creek Rd, Ste C, Arden, NC, 28704', 'Waste Management (Property manages)', null, 1),
    (cid, 'Atlanta', 'ATL', 'Matt Simmons', null, 'Kevin Khaiphanliane', 'Calvin Nguyen', '2001 Lawrenceville-Suwanee Rd #104, Suwanee, GA 30024', '(Property manages)', null, 2),
    (cid, 'Birmingham', 'BM', 'Danny Thornton', 'David Sims', 'N/A', null, '631 Beacon Pkwy W Suite 106, Birmingham, AL, 35209', null, null, 3),
    (cid, 'Cape Girardeau', 'CG', 'Lashamus Dowell', 'Matthew Nichols', 'N/A', 'Alaska Olinger', '1204 Meadowbrook Dr Ste 2, Cape Girardeau, MO, 63703', '(Property manages)', null, 4),
    (cid, 'Chattanooga', 'CT', 'Lashamus Dowell', null, 'Christian Andrews', 'Jacob Blackburn', '5805 Lee Hwy Suite 307, Chattanooga, TN, 37421', 'CWS (Property manages)', null, 5),
    (cid, 'Columbus', 'CB', 'Matt Simmons', 'Matt Simmons', 'N/A', 'Amanda Simmons', '2013 Devonshire Dr #1200, Columbus, GA 31904', '121 Disposal (Property manages)', '334-707-4850', 6),
    (cid, 'Destin', 'DT', 'Danny Thornton', 'Garrett McCarley', 'N/A', 'N/A', null, null, null, 7),
    (cid, 'Huntsville', 'HV', 'Lashamus Dowell', null, 'Jordan Stanley', 'Nathan Wagner', '8207 Stephanie Dr, Huntsville, AL 35802', 'Waste Management', null, 8),
    (cid, 'Jonesboro', 'JB', 'Danny Thornton', 'LaShamus Dowell', 'N/A', 'Farris Bruce', '649 Burke Ave, Jonesboro, AR 72401', 'Dedmans Sanitation (Property manages)', null, 9),
    (cid, 'Jackson, MS', 'JS', 'Danny Thornton', 'Danny Thornton', 'N/A', 'Reggie Stewart', '405 Briarwood Dr, Suite 210A, Jackson, MS, 39206', 'N/A. Danny has a guy pick up 1x/month', null, 10),
    (cid, 'Jackson,TN', 'JT', 'Lashamus Dowell', 'LaShamus Dowell', 'N/A', 'Cameron Forrest', '1903 N Highland Ave, Ste 10, Jackson, TN, 38305', 'Tennessee Waste Management (Property manages)', '800-607-9509', 11),
    (cid, 'Jacksonville', 'JV', 'Matt Simmons', 'Matt Simmons', 'Zakaraya Moradi', 'Farahnaz Moradi', '5913 Normandy Blvd #11, Jacksonville, FL 32210', 'Waste Pro (Property manages)', null, 12),
    (cid, 'Knoxville', 'KV', 'Lashamus Dowell', null, 'Zac Coisman', 'James Houston', '3137 Lakemoor View Road, Knoxville, TN 37920', 'GFL Environmental (Property manages)', '865-475-7777', 13),
    (cid, 'Lake Charles', 'LC', 'Danny Thornton', 'Danny Thornton', 'Cooper Shaffett', 'N/A', null, null, null, 14),
    (cid, 'Little Rock', 'LR', 'Danny Thornton', 'Danny Thornton', 'N/A', 'Blake Shinn', '11701 I-30, Suite 324, Little Rock, AR 72209', null, null, 15),
    (cid, 'Memphis', 'MP', 'Lashamus Dowell', 'Sean Smith', 'N/A', 'Annan Odongo', '3663 Cherry Rd #101, Memphis, TN, 38118', 'Waste Connections of Tennessee', '907-398-5400', 16),
    (cid, 'Mobile', 'MB', 'Danny Thornton', null, 'Dominic Holman', 'Lauren Andrews', '3656 Government Blvd, Ste E Mobile, AL, 36693', 'Gulf coast containers LLC (Property manages)', '251-443-7997', 17),
    (cid, 'Montgomery', 'MT', 'Matt Simmons', 'Matt Simmons', 'N/A', 'Leon Marsh', '1115 Perry Hill Rd Unit C, Montgomery, AL, 36109', null, null, 18),
    (cid, 'Nashville', 'NV', 'Lashamus Dowell', null, 'John Godfrey', 'Juliannah Caviness-Ferguson', '163 N Mt Juliet Rd, Mt Juliet, TN, 37122', 'Republic Services', '(615) 782-5500', 19),
    (cid, 'New Orleans', 'NO', 'Lashamus Dowell', null, 'N/A', 'Shannon Thomas', '179 Belle Terre Blvd, Ste B, Laplace, LA, 70068', 'Waste Connections (Property manages)', '877-747-4374', 20),
    (cid, 'Norfolk', 'NF', 'Matt Simmons', 'Chris Simpson', 'N/A', 'Brandi Janell Smith', '1905 S Military Highway, Suite 110, Chesapeake, Virginia, 23320', null, null, 21),
    (cid, 'Richmond', 'RM', 'Matt Simmons', 'Chris Simpson', null, 'Kolby Fleck', '4501 Williamsburg Rd, Ste H, Richmond, VA 23231', '(Property manages)', null, 22),
    (cid, 'Raleigh', 'RL', 'Matt Simmons', null, null, 'Mason Redker', '313 US-70 Suite B Garner, NC 27529', 'Patriot (Property manages)', '(919) 773-8008', 23),
    (cid, 'San Antonio', 'SA', 'Danny Thornton', 'Erick Guzman', 'N/A', 'N/A', null, null, null, 24),
    (cid, 'Savannah', 'SV', 'Matt Simmons', 'Lance Novak', 'N/A', 'Christopher Kennelley', '24 Commerce Pl Unit A, Savannah, GA, 31406', 'Republic Services (Property manages)', '(912) 964-2211', 25),
    (cid, 'St. Louis', 'STL', 'Lashamus Dowell', 'Derious Nichols', 'N/A', 'Crystal Dziedzic', '11040 Lin Valle Dr, Suite D, St. Louis, MO 63123', '(Property manages)', null, 26),
    (cid, 'Tallahassee', 'TL', 'Danny Thornton', 'Matthew McCrary', 'N/A', 'Krista Griffiss', '5281 Tower Rd Unit B5, Tallahassee, FL 32303', null, null, 27),
    (cid, 'Wilmington', 'WM', 'Matt Simmons', 'BryeShawn Butler', 'N/A', 'David Lopez', '108 N Kerr Ave #H2 Wilmington NC 28405', 'Wall Recycling (Property manages)', '910-444-7777', 28);
  end if;

  if not exists (select 1 from staff_list_tier_level where company_id = cid limit 1) then
    insert into staff_list_tier_level (company_id, tier, ticket_rate, mile_200, mile_300, mile_400, mileage_pay, branch_incentive, distance_home_comp, row_sort) values
    (cid, 'Branch Manager', 55, 40, 60, 80, 0.4, '$0 per branch completions', 'over 50 mile = $20 daily', 1),
    (cid, 'Tech Manager', 50, null, null, null, null, '$0 per branch completions', null, 2),
    (cid, 'tier 1', 45, null, null, null, null, '$10 per branch completions', null, 3),
    (cid, 'tier 2', 40, null, null, null, null, '$10 per branch completions', null, 4);
  end if;
end $$;
