-- Business Documents module V1: business fields, signers, document sources /
-- snapshots / templates / fields / instances / overrides / final documents.
-- All tables are new; no existing data is touched.

-- BusinessField: global fixed fields library.
CREATE TABLE "BusinessField" (
    "id"        TEXT         NOT NULL,
    "key"       TEXT         NOT NULL,
    "label"     TEXT         NOT NULL,
    "value"     TEXT         NOT NULL DEFAULT '',
    "category"  TEXT,
    "order"     INTEGER      NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessField_key_key" ON "BusinessField"("key");

-- SignerPerson: who signs. extraFields is JSONB for arbitrary extra field
-- values keyed by stable string keys (referenced by DocumentField.signerFieldKey).
CREATE TABLE "SignerPerson" (
    "id"          TEXT         NOT NULL,
    "displayName" TEXT         NOT NULL,
    "role"        TEXT,
    "email"       TEXT,
    "phone"       TEXT,
    "extraFields" JSONB        NOT NULL DEFAULT '{}',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignerPerson_pkey" PRIMARY KEY ("id")
);

-- SignerAsset: PNG blob (renderedBytes) is canonical; the others are retained
-- for potential re-composition.
CREATE TABLE "SignerAsset" (
    "id"              TEXT         NOT NULL,
    "personId"        TEXT         NOT NULL,
    "assetType"       TEXT         NOT NULL,
    "label"           TEXT,
    "renderedBytes"   BYTEA        NOT NULL,
    "drawBytes"       BYTEA,
    "stampConfigJson" JSONB,
    "byteSize"        INTEGER      NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignerAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SignerAsset_personId_idx" ON "SignerAsset"("personId");
ALTER TABLE "SignerAsset"
    ADD CONSTRAINT "SignerAsset_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "SignerPerson"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- DocumentSource: original uploaded file. V1 = PDF only.
CREATE TABLE "DocumentSource" (
    "id"         TEXT         NOT NULL,
    "filename"   TEXT         NOT NULL,
    "mimeType"   TEXT         NOT NULL,
    "sourceKind" TEXT         NOT NULL,
    "bytes"      BYTEA        NOT NULL,
    "byteSize"   INTEGER      NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSource_pkey" PRIMARY KEY ("id")
);

-- DocumentSnapshot: the stable PDF rendering. V1 generator = 'passthrough'.
CREATE TABLE "DocumentSnapshot" (
    "id"               TEXT         NOT NULL,
    "sourceId"         TEXT         NOT NULL,
    "pdfBytes"         BYTEA        NOT NULL,
    "pageCount"        INTEGER      NOT NULL,
    "generator"        TEXT         NOT NULL DEFAULT 'passthrough',
    "generatorVersion" TEXT         NOT NULL DEFAULT 'v1',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSnapshot_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "DocumentSnapshot"
    ADD CONSTRAINT "DocumentSnapshot_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "DocumentSource"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- DocumentTemplate: named wrapper around a snapshot + fields.
CREATE TABLE "DocumentTemplate" (
    "id"          TEXT         NOT NULL,
    "title"       TEXT         NOT NULL,
    "description" TEXT,
    "snapshotId"  TEXT         NOT NULL,
    "status"      TEXT         NOT NULL DEFAULT 'draft',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "DocumentTemplate"
    ADD CONSTRAINT "DocumentTemplate_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "DocumentSnapshot"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- DocumentField: field placement. Percentage coords from page top-left.
CREATE TABLE "DocumentField" (
    "id"              TEXT    NOT NULL,
    "templateId"      TEXT    NOT NULL,
    "page"            INTEGER NOT NULL,
    "xPct"            DOUBLE PRECISION NOT NULL,
    "yPct"            DOUBLE PRECISION NOT NULL,
    "wPct"            DOUBLE PRECISION NOT NULL,
    "hPct"            DOUBLE PRECISION NOT NULL,
    "fieldType"       TEXT    NOT NULL,
    "label"           TEXT    NOT NULL DEFAULT '',
    "required"        BOOLEAN NOT NULL DEFAULT false,
    "order"           INTEGER NOT NULL DEFAULT 0,
    "valueSource"     TEXT    NOT NULL DEFAULT 'override_only',
    "businessFieldId" TEXT,
    "signerPersonId"  TEXT,
    "signerFieldKey"  TEXT,
    "signerAssetMode" TEXT,
    "staticValue"     TEXT,

    CONSTRAINT "DocumentField_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentField_templateId_page_idx" ON "DocumentField"("templateId", "page");
ALTER TABLE "DocumentField"
    ADD CONSTRAINT "DocumentField_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- DocumentInstance: specific use of a template with its own FROZEN snapshot
-- of PDF bytes, fields, business fields and signers at create time.
CREATE TABLE "DocumentInstance" (
    "id"                TEXT         NOT NULL,
    "templateId"        TEXT         NOT NULL,
    "title"             TEXT         NOT NULL,
    "status"            TEXT         NOT NULL DEFAULT 'draft',
    "fieldsSnapshot"    JSONB        NOT NULL,
    "snapshotPdfBytes"  BYTEA        NOT NULL,
    "snapshotPageCount" INTEGER      NOT NULL,
    "businessSnapshot"  JSONB        NOT NULL,
    "signersSnapshot"   JSONB        NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    "finalizedAt"       TIMESTAMP(3),

    CONSTRAINT "DocumentInstance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentInstance_templateId_idx" ON "DocumentInstance"("templateId");
ALTER TABLE "DocumentInstance"
    ADD CONSTRAINT "DocumentInstance_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- DocumentInstanceOverride: per-field override scoped to one instance only.
CREATE TABLE "DocumentInstanceOverride" (
    "id"              TEXT         NOT NULL,
    "instanceId"      TEXT         NOT NULL,
    "snapshotFieldId" TEXT         NOT NULL,
    "textValue"       TEXT,
    "assetBytes"      BYTEA,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentInstanceOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentInstanceOverride_instanceId_snapshotFieldId_key"
    ON "DocumentInstanceOverride"("instanceId", "snapshotFieldId");
ALTER TABLE "DocumentInstanceOverride"
    ADD CONSTRAINT "DocumentInstanceOverride_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "DocumentInstance"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FinalDocument: rendered final PDF, append-only.
CREATE TABLE "FinalDocument" (
    "id"               TEXT         NOT NULL,
    "instanceId"       TEXT         NOT NULL,
    "pdfBytes"         BYTEA        NOT NULL,
    "pdfSize"          INTEGER      NOT NULL,
    "generatorVersion" TEXT         NOT NULL DEFAULT 'v1',
    "generatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinalDocument_instanceId_idx" ON "FinalDocument"("instanceId");
ALTER TABLE "FinalDocument"
    ADD CONSTRAINT "FinalDocument_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "DocumentInstance"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
