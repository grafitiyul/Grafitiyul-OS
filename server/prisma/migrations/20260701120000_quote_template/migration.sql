-- Quote Layout Template: single-row global default quote composition.
-- Additive only; no existing quote data is touched. The row is created lazily
-- by the service on first save (upsert on the unique `singleton`).
CREATE TABLE "QuoteTemplate" (
    "id" TEXT NOT NULL,
    "singleton" TEXT NOT NULL DEFAULT 'global',
    "layout" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuoteTemplate_singleton_key" ON "QuoteTemplate"("singleton");
