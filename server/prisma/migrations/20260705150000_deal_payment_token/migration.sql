-- Permanent customer-facing payment token per Deal (/pay/<token> redirects to
-- the current iCount link). ADDITIVE only: one nullable column + unique index.
-- Only the token is stored — the display URL is built from PUBLIC_ORIGIN at
-- request time, so a future domain change needs no data migration.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "paymentToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Deal_paymentToken_key" ON "Deal"("paymentToken");
