-- Deal Marketing — THE canonical marketing/attribution entity for a Deal.
--
-- Permanent, not a migration panel. Populated from Pipedrive's marketing custom
-- fields today; populated by the ingress platform after each source cuts over.
-- The field set is deliberately wider than what Pipedrive can fill (it holds NO
-- UTM data at all — measured over 24,640 deals), so that cutover is a change of
-- WRITER, never a change of SCHEMA, and the Deal panel never has to be rebuilt.
--
-- firstTouch* is immutable once set; latestTouch* is freely overwritten.
-- Additive only — no existing table is touched.
CREATE TABLE "DealMarketing" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "leadSource" TEXT,
    "leadSourceKey" TEXT,
    "leadSourceText" TEXT,
    "channel" TEXT,
    "campaign" TEXT,
    "medium" TEXT,
    "content" TEXT,
    "term" TEXT,
    "landingUrl" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "adId" TEXT,
    "adsetId" TEXT,
    "campaignId" TEXT,
    "firstTouchAt" TIMESTAMP(3),
    "firstTouchSource" TEXT,
    "firstTouchCampaign" TEXT,
    "latestTouchAt" TIMESTAMP(3),
    "latestTouchSource" TEXT,
    "originalIngressSource" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "attributionRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealMarketing_pkey" PRIMARY KEY ("id")
);

-- One marketing record per deal.
CREATE UNIQUE INDEX "DealMarketing_dealId_key" ON "DealMarketing"("dealId");

CREATE INDEX "DealMarketing_leadSourceKey_idx" ON "DealMarketing"("leadSourceKey");
CREATE INDEX "DealMarketing_channel_idx" ON "DealMarketing"("channel");
CREATE INDEX "DealMarketing_campaign_idx" ON "DealMarketing"("campaign");
CREATE INDEX "DealMarketing_sourceCreatedAt_idx" ON "DealMarketing"("sourceCreatedAt");

ALTER TABLE "DealMarketing"
  ADD CONSTRAINT "DealMarketing_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
