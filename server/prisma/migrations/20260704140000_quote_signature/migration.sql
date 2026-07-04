-- QuoteSignature — the permanent audit record of a signed proposal.
-- ADDITIVE only: one new table + a unique FK to QuoteDocument (the lock: exactly
-- one signature per document; a later change requires a new QuoteDocument
-- revision). No changes to existing tables, no data migration. The signature is
-- never stored in the quote HTML.
--
-- Defensive (IF NOT EXISTS) so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "QuoteSignature" (
  "id"              TEXT NOT NULL,
  "quoteDocumentId" TEXT NOT NULL,
  "quoteVersionId"  TEXT NOT NULL,
  "method"          TEXT NOT NULL,
  "signerName"      TEXT NOT NULL,
  "signatureImage"  TEXT,
  "signedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress"       TEXT,
  "userAgent"       TEXT,
  "language"        TEXT NOT NULL DEFAULT 'he',
  "timezone"        TEXT,
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteSignature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteSignature_quoteDocumentId_key" ON "QuoteSignature"("quoteDocumentId");
CREATE INDEX IF NOT EXISTS "QuoteSignature_quoteDocumentId_idx" ON "QuoteSignature"("quoteDocumentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'QuoteSignature_quoteDocumentId_fkey'
  ) THEN
    ALTER TABLE "QuoteSignature"
      ADD CONSTRAINT "QuoteSignature_quoteDocumentId_fkey"
      FOREIGN KEY ("quoteDocumentId") REFERENCES "QuoteDocument"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
