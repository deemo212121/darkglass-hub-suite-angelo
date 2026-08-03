-- Wipe the truck_stock table so we can re-import the cleaned-up
-- workbook seed without colliding with the bad rows imported on the
-- first pass (when the parser was reading wrong columns).
truncate table truck_stock;
