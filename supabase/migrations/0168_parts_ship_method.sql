-- =====================================================================
-- 0168 — parts.ship_method: the real carrier/shipping method selected
-- when a PO was placed (e.g. "FedEx Ground", "UPS Ground", "Will Call"),
-- so Part Receive's tracking link can route to the right carrier
-- directly instead of guessing from the tracking number's shape.
--
-- Only ever populated by the Marcone/Encompass order-placement flow
-- (MarconePartsOrderModal) — that's the only place a shipping method is
-- actually selected today. Parts ordered any other way stay null, and
-- Part Receive falls back to its existing pattern-matching heuristic.
--
-- Run once in the Supabase SQL Editor, after 0167.
-- =====================================================================

alter table parts add column if not exists ship_method text;
