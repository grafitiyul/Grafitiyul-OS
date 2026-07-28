-- Internal reusable WhatsApp wording ("נוסחים לתבניות ווטסאפ"). One record owns
-- both languages; bodies are editor HTML (chips for variables), serialized to
-- WhatsApp markup at resolve time by the shared htmlToWhatsApp.
--
-- (sourceSystem, sourceRecordId) is the one-time Airtable crosswalk key so the
-- import can upsert idempotently. Additive only — no existing table touched.
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "bodyHeHtml" TEXT,
    "bodyEnHtml" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceSystem" TEXT,
    "sourceRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppTemplate_sourceSystem_sourceRecordId_key" ON "WhatsAppTemplate"("sourceSystem", "sourceRecordId");

CREATE INDEX "WhatsAppTemplate_isActive_sortOrder_idx" ON "WhatsAppTemplate"("isActive", "sortOrder");
