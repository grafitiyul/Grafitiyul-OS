-- PriceRule: "Available for Group Ticket Sales" — a card-level business capability.
-- ADDITIVE, defaulted false so every existing card stays OUT of the Group Ticket
-- Builder until the owner opts it in. Duplicated across a card's sibling rules
-- (one per location), like cardSortOrder. The flag is the SOLE authority for which
-- cards the Group Ticket Builder loads — no product/city/activity/hardcoded logic.
-- Safe to re-run.

ALTER TABLE "PriceRule" ADD COLUMN IF NOT EXISTS "availableForGroupTickets" BOOLEAN NOT NULL DEFAULT false;
