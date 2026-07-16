-- Travel Agency Reservations foundation (Slice 1) — purely additive.
-- AgentReservationLink (permanent per-agent capability token) +
-- ReservationSession / ReservationGroup (canonical reservation intake) +
-- OrganizationType.agentReservations eligibility flag.
-- No existing table is dropped or rewritten; new tables start empty.
-- See docs/architecture/GOS-travel-agent-reservation-module-plan.md.

-- Eligibility capability flag: logic reads THIS, never the Hebrew label.
ALTER TABLE "OrganizationType" ADD COLUMN "agentReservations" BOOLEAN NOT NULL DEFAULT false;

-- Human session reference — dedicated sequence (deal_order_no_seq pattern):
-- monotonic, gaps allowed, never reused. Table starts empty, no backfill.
CREATE SEQUENCE "reservation_session_no_seq" START WITH 1000;

-- ── AgentReservationLink ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentReservationLink" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'he',
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentReservationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentReservationLink_token_key" ON "AgentReservationLink"("token");
CREATE INDEX IF NOT EXISTS "AgentReservationLink_contactId_status_idx" ON "AgentReservationLink"("contactId", "status");

ALTER TABLE "AgentReservationLink"
  ADD CONSTRAINT "AgentReservationLink_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ReservationSession ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ReservationSession" (
    "id" TEXT NOT NULL,
    "sessionNo" INTEGER NOT NULL DEFAULT nextval('reservation_session_no_seq'),
    "source" TEXT NOT NULL DEFAULT 'travel_agent',
    "linkId" TEXT,
    "contactId" TEXT,
    "organizationId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'he',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submissionKey" TEXT NOT NULL,
    "payloadSnapshot" JSONB NOT NULL,
    "signerName" TEXT,
    "signatureMethod" TEXT,
    "signatureBytes" BYTEA,
    "legalConfirmations" JSONB,
    "clientMeta" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "claimId" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReservationSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReservationSession_sessionNo_key" ON "ReservationSession"("sessionNo");
CREATE UNIQUE INDEX IF NOT EXISTS "ReservationSession_submissionKey_key" ON "ReservationSession"("submissionKey");
CREATE INDEX IF NOT EXISTS "ReservationSession_status_nextRetryAt_idx" ON "ReservationSession"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "ReservationSession_contactId_idx" ON "ReservationSession"("contactId");
CREATE INDEX IF NOT EXISTS "ReservationSession_organizationId_idx" ON "ReservationSession"("organizationId");
CREATE INDEX IF NOT EXISTS "ReservationSession_linkId_idx" ON "ReservationSession"("linkId");
CREATE INDEX IF NOT EXISTS "ReservationSession_submittedAt_idx" ON "ReservationSession"("submittedAt");

-- Drop the sequence automatically if the column is ever dropped.
ALTER SEQUENCE "reservation_session_no_seq" OWNED BY "ReservationSession"."sessionNo";

ALTER TABLE "ReservationSession"
  ADD CONSTRAINT "ReservationSession_linkId_fkey"
  FOREIGN KEY ("linkId") REFERENCES "AgentReservationLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReservationSession"
  ADD CONSTRAINT "ReservationSession_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReservationSession"
  ADD CONSTRAINT "ReservationSession_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── ReservationGroup ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ReservationGroup" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "groupName" TEXT NOT NULL,
    "productId" TEXT,
    "productVariantId" TEXT,
    "locationId" TEXT,
    "productLabel" TEXT,
    "locationLabel" TEXT,
    "tourDate" TEXT NOT NULL,
    "tourTime" TEXT,
    "participants" INTEGER NOT NULL,
    "tourLanguage" TEXT,
    "onSiteContactName" TEXT,
    "onSiteContactPhone" TEXT,
    "notes" TEXT,
    "createdDealId" TEXT,
    "processedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReservationGroup_pkey" PRIMARY KEY ("id")
);

-- Exactly-once anchor: one Deal per group, ever.
CREATE UNIQUE INDEX IF NOT EXISTS "ReservationGroup_createdDealId_key" ON "ReservationGroup"("createdDealId");
CREATE INDEX IF NOT EXISTS "ReservationGroup_sessionId_status_idx" ON "ReservationGroup"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "ReservationGroup_productVariantId_idx" ON "ReservationGroup"("productVariantId");
CREATE INDEX IF NOT EXISTS "ReservationGroup_locationId_idx" ON "ReservationGroup"("locationId");

ALTER TABLE "ReservationGroup"
  ADD CONSTRAINT "ReservationGroup_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ReservationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReservationGroup"
  ADD CONSTRAINT "ReservationGroup_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReservationGroup"
  ADD CONSTRAINT "ReservationGroup_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReservationGroup"
  ADD CONSTRAINT "ReservationGroup_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReservationGroup"
  ADD CONSTRAINT "ReservationGroup_createdDealId_fkey"
  FOREIGN KEY ("createdDealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
