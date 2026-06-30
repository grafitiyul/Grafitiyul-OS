-- Location: city marketing content for quotes. ADDITIVE + nullable. Owned by the
-- Location (NOT a generic QuoteSection) — the City content block reads it. Rich
-- HTML, bilingual. No pricing/workflow impact. Safe to re-run.

ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "marketingDescHe" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "marketingDescEn" TEXT;
