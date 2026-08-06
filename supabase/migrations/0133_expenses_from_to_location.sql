-- Free-text origin/destination fields on expenses, carried over from a
-- Flash Tech trip's origin_location/destination_location when a Hotel or
-- Transportation expense is auto-created for it (see flashTechTrips.ts),
-- but usable on any expense.
alter table expenses add column if not exists from_location text;
alter table expenses add column if not exists to_location text;
