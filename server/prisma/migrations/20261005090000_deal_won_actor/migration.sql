-- The immutable actor of the WON transition, frozen by transitionDealToWon in
-- the same atomic write as status/wonAt. Nullable: legacy WON deals whose
-- closer cannot be proven stay NULL and render as an explicit "unknown".
ALTER TABLE "Deal" ADD COLUMN "wonActor" JSONB;
