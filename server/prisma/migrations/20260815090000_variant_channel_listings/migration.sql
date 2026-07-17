-- Channel presentation for canonical ProductVariants (travel-agent channel
-- first; website/schools/corporate/partners/API later). Presentation only —
-- no second catalogue, deals keep storing canonical product/variant/location.
-- Purely additive; table starts empty (variants are invisible on a channel
-- until the owner lists them).
CREATE TABLE IF NOT EXISTS "VariantChannelListing" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT NOT NULL,
    "displayNameEn" TEXT,
    "description" TEXT,
    "commercialCity" TEXT NOT NULL,
    "commercialCityEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VariantChannelListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VariantChannelListing_productVariantId_channel_key"
  ON "VariantChannelListing"("productVariantId", "channel");
CREATE INDEX IF NOT EXISTS "VariantChannelListing_channel_visible_sortOrder_idx"
  ON "VariantChannelListing"("channel", "visible", "sortOrder");

ALTER TABLE "VariantChannelListing"
  ADD CONSTRAINT "VariantChannelListing_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
