-- Collection evidence & historical reconstruction.
--
-- Three additions, no destructive change:
--   1. IcountDocument gains the fields a HISTORICAL document needs (its real
--      issue date, the money it records, why it was attached, when iCount last
--      confirmed it) — every one nullable, so existing rows are untouched.
--   2. IcountLedgerDoc: a read-only local mirror of the whole iCount account,
--      used to resolve/verify document references without an API call each.
--      Pure cache — safe to truncate and rebuild.
--   3. DealCollectionEvidence: operator-attested money (manual payments,
--      credits, explicit settlements). Deliberately a SEPARATE table from
--      IcountDocument so manual money can never be rendered as a verified
--      accounting document.
--   4. Deal.collectionReview: the "a human must look at this" flag.

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "IcountDocument"
  ADD COLUMN "issuedAt"       TIMESTAMP(3),
  ADD COLUMN "paidMinor"      BIGINT,
  ADD COLUMN "linkConfidence" TEXT,
  ADD COLUMN "linkReason"     TEXT,
  ADD COLUMN "verifiedAt"     TIMESTAMP(3);

CREATE INDEX "IcountDocument_doctype_docnum_idx" ON "IcountDocument"("doctype", "docnum");

-- 2 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "IcountLedgerDoc" (
  "id"             TEXT NOT NULL,
  "doctype"        TEXT NOT NULL,
  "docnum"         TEXT NOT NULL,
  "issuedAt"       TIMESTAMP(3) NOT NULL,
  "clientId"       TEXT,
  "clientName"     TEXT,
  "clientVatId"    TEXT,
  "currency"       TEXT NOT NULL DEFAULT 'ILS',
  "fxRate"         TEXT,
  "totalMinor"     BIGINT NOT NULL,
  "paidMinor"      BIGINT,
  "vatMinor"       BIGINT,
  "vatPercent"     TEXT,
  "isCancelled"    BOOLEAN NOT NULL DEFAULT false,
  "isCancellation" BOOLEAN NOT NULL DEFAULT false,
  "providerStatus" INTEGER,
  "docUrl"         TEXT,
  "basedOn"        JSONB,
  "basedOnThis"    JSONB,
  "raw"            JSONB,
  "syncedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IcountLedgerDoc_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IcountLedgerDoc_doctype_docnum_key" ON "IcountLedgerDoc"("doctype", "docnum");
CREATE INDEX "IcountLedgerDoc_docnum_idx"   ON "IcountLedgerDoc"("docnum");
CREATE INDEX "IcountLedgerDoc_issuedAt_idx" ON "IcountLedgerDoc"("issuedAt");
CREATE INDEX "IcountLedgerDoc_clientId_idx" ON "IcountLedgerDoc"("clientId");

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "DealCollectionEvidence" (
  "id"             TEXT NOT NULL,
  "dealId"         TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "direction"      TEXT NOT NULL,
  "amountMinor"    BIGINT NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'ILS',
  "paidAt"         TIMESTAMP(3) NOT NULL,
  "method"         TEXT,
  "reference"      TEXT,
  "note"           TEXT,
  "fileId"         TEXT,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "reversedAt"     TIMESTAMP(3),
  "reversedBy"     TEXT,
  "reversedByName" TEXT,
  "reversalReason" TEXT,
  "origin"         TEXT NOT NULL DEFAULT 'operator',
  "createdBy"      TEXT,
  "createdByName"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealCollectionEvidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DealCollectionEvidence_dealId_status_idx" ON "DealCollectionEvidence"("dealId", "status");

ALTER TABLE "DealCollectionEvidence"
  ADD CONSTRAINT "DealCollectionEvidence_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DealCollectionEvidence"
  ADD CONSTRAINT "DealCollectionEvidence_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "DealFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Deal" ADD COLUMN "collectionReview" JSONB;
