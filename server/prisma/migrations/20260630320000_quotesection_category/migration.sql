-- QuoteSection: library classification so reusable content is structured, not an
-- unstructured pile. ADDITIVE + nullable. Validated at the API (no Postgres enum):
-- faq | cancellation | participant_policy | why_us | marketing | terms | custom.
-- Safe to re-run.

ALTER TABLE "QuoteSection" ADD COLUMN IF NOT EXISTS "category" TEXT;
