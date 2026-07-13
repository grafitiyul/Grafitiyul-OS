-- Canonical no-payment waiver (independent commercial decision; QuoteLines keep
-- real prices, valueMinor = gross - waived). Additive + nullable.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "noPaymentWaiver" JSONB;
