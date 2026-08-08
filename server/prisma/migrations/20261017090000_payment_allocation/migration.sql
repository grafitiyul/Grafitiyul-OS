-- Multi-deal payment allocation, first-class.
--
-- Purely ADDITIVE: every column is nullable and every existing row keeps its
-- current meaning (allocationMinor NULL = "this row is the whole payment").
-- No backfill is needed and no existing read changes behaviour.

-- ── IcountDocument ───────────────────────────────────────────────────────────
ALTER TABLE "IcountDocument"
  ADD COLUMN "allocationGroupId"    TEXT,
  ADD COLUMN "allocationSource"     TEXT,
  ADD COLUMN "allocationNote"       TEXT,
  ADD COLUMN "allocatedBy"          TEXT,
  ADD COLUMN "allocatedByName"      TEXT,
  ADD COLUMN "allocatedAt"          TIMESTAMP(3),
  ADD COLUMN "basedOnDocs"          JSONB,
  ADD COLUMN "paymentProvider"      TEXT,
  ADD COLUMN "paymentTransactionId" TEXT,
  ADD COLUMN "paymentApprovalCode"  TEXT,
  ADD COLUMN "paymentMeta"          JSONB;

CREATE INDEX "IcountDocument_paymentProvider_paymentTransactionId_idx"
  ON "IcountDocument"("paymentProvider", "paymentTransactionId");

-- The 34 historical shared documents already carry allocationMinor. Give them
-- the provenance they were always missing, so the new UI never shows a split
-- with an unexplained origin. Their group identity is the provider document
-- number, which is exactly what companyCollectionTotals already dedupes on.
UPDATE "IcountDocument"
   SET "allocationSource"  = 'migration',
       "allocationGroupId" = 'doc:' || "doctype" || ':' || COALESCE("docnum", "id"),
       "allocationNote"    = 'שיוך היסטורי מהמיגרציה — מסמך מאוחד שסוגר כמה עסקאות'
 WHERE "allocationMinor" IS NOT NULL
   AND "allocationSource" IS NULL;

-- ── DealCollectionEvidence ───────────────────────────────────────────────────
ALTER TABLE "DealCollectionEvidence"
  ADD COLUMN "allocationMinor"      BIGINT,
  ADD COLUMN "allocationGroupId"    TEXT,
  ADD COLUMN "allocationSource"     TEXT,
  ADD COLUMN "allocationNote"       TEXT,
  ADD COLUMN "allocatedBy"          TEXT,
  ADD COLUMN "allocatedByName"      TEXT,
  ADD COLUMN "allocatedAt"          TIMESTAMP(3),
  ADD COLUMN "paymentProvider"      TEXT,
  ADD COLUMN "paymentTransactionId" TEXT,
  ADD COLUMN "paymentApprovalCode"  TEXT,
  ADD COLUMN "paymentMeta"          JSONB;

CREATE INDEX "DealCollectionEvidence_paymentProvider_paymentTransactionId_idx"
  ON "DealCollectionEvidence"("paymentProvider", "paymentTransactionId");

-- At most ONE row per (payment, deal) — the idempotency guarantee for a
-- retried allocation. Verified against production first: zero existing
-- (doctype, docnum, dealId) duplicates, and NULL group ids are distinct in
-- Postgres so every un-allocated historical row is unaffected.
CREATE UNIQUE INDEX "IcountDocument_allocationGroupId_dealId_key"
  ON "IcountDocument"("allocationGroupId", "dealId");
CREATE UNIQUE INDEX "DealCollectionEvidence_allocationGroupId_dealId_key"
  ON "DealCollectionEvidence"("allocationGroupId", "dealId");

-- ── Allocation audit ─────────────────────────────────────────────────────────
CREATE TABLE "PaymentAllocationEvent" (
  "id"                  TEXT NOT NULL,
  "sourceKind"          TEXT NOT NULL,
  "allocationGroupId"   TEXT,
  "doctype"             TEXT,
  "docnum"              TEXT,
  "sourceAmountMinor"   BIGINT,
  "action"              TEXT NOT NULL,
  "dealId"              TEXT NOT NULL,
  "orderNo"             INTEGER,
  "previousMinor"       BIGINT,
  "nextMinor"           BIGINT,
  "currency"            TEXT NOT NULL DEFAULT 'ILS',
  "allocatedTotalMinor" BIGINT,
  "unallocatedMinor"    BIGINT,
  "overAllocatedMinor"  BIGINT,
  "reason"              TEXT,
  "actorType"           TEXT NOT NULL DEFAULT 'user',
  "actorId"             TEXT,
  "actorName"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentAllocationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentAllocationEvent_allocationGroupId_idx"
  ON "PaymentAllocationEvent"("allocationGroupId");
CREATE INDEX "PaymentAllocationEvent_dealId_idx"
  ON "PaymentAllocationEvent"("dealId");
CREATE INDEX "PaymentAllocationEvent_doctype_docnum_idx"
  ON "PaymentAllocationEvent"("doctype", "docnum");
