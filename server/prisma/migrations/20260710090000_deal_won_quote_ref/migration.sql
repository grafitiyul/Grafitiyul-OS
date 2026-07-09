-- WON → primary quote stamp: audit snapshot of the primary offer's latest
-- generated quote at the moment a deal is marked WON. Written only on the
-- transition; no retroactive backfill (old WON deals stay null by design).
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "wonQuoteRef" JSONB;
