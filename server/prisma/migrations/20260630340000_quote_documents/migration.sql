-- Quote Module — Slice 1: QuoteDocument + QuoteDocumentRender (foundation only).
--
-- QuoteDocument is the DRAFT/PRODUCED composed proposal; it belongs to a Deal and
-- references the priced QuoteVersion it renders. No renderer / public page /
-- signature / PDF / delivery in this slice — storage shape only. No prices live
-- here (the Builder's QuoteVersion/QuoteLine is the single source of commercial
-- data). QuoteDocumentRender records rendered artifacts; bytes live in R2 via
-- MediaFile (no duplicate r2Key/url). Fully additive + idempotent. Safe to re-run.

-- ── Tables ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QuoteDocument" (
  "id"                  TEXT NOT NULL,
  "dealId"              TEXT NOT NULL,
  "quoteVersionId"      TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'draft',
  "language"            TEXT NOT NULL DEFAULT 'he',
  "publicToken"         TEXT NOT NULL,
  "expiresAt"           TIMESTAMP(3),
  "producedAt"          TIMESTAMP(3),
  "displayProductName"  TEXT,
  "personalIntro"       TEXT,
  "compositionDraft"    JSONB,
  "overrideState"       JSONB,
  "renderModelSnapshot" JSONB,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuoteDocumentRender" (
  "id"              TEXT NOT NULL,
  "quoteDocumentId" TEXT NOT NULL,
  "format"          TEXT NOT NULL,
  "contentHash"     TEXT,
  "rendererVersion" TEXT NOT NULL DEFAULT 'v1',
  "mediaFileId"     TEXT,
  "byteSize"        INTEGER,
  "generatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuoteDocumentRender_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "QuoteDocument_publicToken_key" ON "QuoteDocument"("publicToken");
CREATE INDEX IF NOT EXISTS "QuoteDocument_dealId_idx" ON "QuoteDocument"("dealId");
CREATE INDEX IF NOT EXISTS "QuoteDocument_quoteVersionId_idx" ON "QuoteDocument"("quoteVersionId");
CREATE INDEX IF NOT EXISTS "QuoteDocument_status_idx" ON "QuoteDocument"("status");
CREATE INDEX IF NOT EXISTS "QuoteDocumentRender_quoteDocumentId_idx" ON "QuoteDocumentRender"("quoteDocumentId");
CREATE INDEX IF NOT EXISTS "QuoteDocumentRender_mediaFileId_idx" ON "QuoteDocumentRender"("mediaFileId");

-- ── Foreign keys (defensive; ON DELETE matches schema) ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteDocument_dealId_fkey') THEN
    ALTER TABLE "QuoteDocument" ADD CONSTRAINT "QuoteDocument_dealId_fkey"
      FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteDocument_quoteVersionId_fkey') THEN
    ALTER TABLE "QuoteDocument" ADD CONSTRAINT "QuoteDocument_quoteVersionId_fkey"
      FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteDocumentRender_quoteDocumentId_fkey') THEN
    ALTER TABLE "QuoteDocumentRender" ADD CONSTRAINT "QuoteDocumentRender_quoteDocumentId_fkey"
      FOREIGN KEY ("quoteDocumentId") REFERENCES "QuoteDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteDocumentRender_mediaFileId_fkey') THEN
    ALTER TABLE "QuoteDocumentRender" ADD CONSTRAINT "QuoteDocumentRender_mediaFileId_fkey"
      FOREIGN KEY ("mediaFileId") REFERENCES "MediaFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
