-- Guide Management module (8A + 8B)
-- ============================================================================
-- Adds:
--   * TeamRef (identity layer — opaque handle into recruitment teams)
--   * PersonRef (identity layer for guides; owns identity fields + portal auth)
--   * PersonProfile (operational layer — always owned by this system)
--   * FlowTargetTeam / FlowTargetPerson (flow assignment join tables)
--   * Flow.openToAll / Flow.mandatory (assignment flags)
--   * Attempt.externalPersonId (stable link from attempts back to guides)
--
-- Design rationale: see schema.prisma block comments and CLAUDE.md architecture
-- decisions on identity-vs-operational separation.
-- ============================================================================

-- ---------- TeamRef ----------
CREATE TABLE "TeamRef" (
    "id"             TEXT         NOT NULL,
    "externalTeamId" TEXT         NOT NULL,
    "displayName"    TEXT         NOT NULL,
    "meta"           JSONB,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamRef_externalTeamId_key" ON "TeamRef"("externalTeamId");

-- ---------- PersonRef ----------
CREATE TABLE "PersonRef" (
    "id"               TEXT         NOT NULL,
    "externalPersonId" TEXT         NOT NULL,
    "identitySource"   TEXT         NOT NULL DEFAULT 'recruitment',
    "displayName"      TEXT         NOT NULL,
    "email"            TEXT,
    "phone"            TEXT,
    "identitySyncedAt" TIMESTAMP(3),
    "status"           TEXT         NOT NULL DEFAULT 'active',
    "teamRefId"        TEXT,
    "portalToken"      TEXT         NOT NULL,
    "portalEnabled"    BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonRef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonRef_externalPersonId_key" ON "PersonRef"("externalPersonId");
CREATE UNIQUE INDEX "PersonRef_portalToken_key"      ON "PersonRef"("portalToken");
CREATE INDEX        "PersonRef_teamRefId_idx"        ON "PersonRef"("teamRefId");
ALTER TABLE "PersonRef"
    ADD CONSTRAINT "PersonRef_teamRefId_fkey"
    FOREIGN KEY ("teamRefId") REFERENCES "TeamRef"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- PersonProfile ----------
CREATE TABLE "PersonProfile" (
    "personRefId" TEXT         NOT NULL,
    "imageUrl"    TEXT,
    "description" TEXT,
    "notes"       TEXT,
    "bankDetails" JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonProfile_pkey" PRIMARY KEY ("personRefId")
);
ALTER TABLE "PersonProfile"
    ADD CONSTRAINT "PersonProfile_personRefId_fkey"
    FOREIGN KEY ("personRefId") REFERENCES "PersonRef"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Flow assignment columns ----------
ALTER TABLE "Flow"
    ADD COLUMN "openToAll" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mandatory" BOOLEAN NOT NULL DEFAULT true;

-- ---------- FlowTargetTeam ----------
CREATE TABLE "FlowTargetTeam" (
    "flowId"     TEXT         NOT NULL,
    "teamRefId"  TEXT         NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowTargetTeam_pkey" PRIMARY KEY ("flowId", "teamRefId")
);
CREATE INDEX "FlowTargetTeam_teamRefId_idx" ON "FlowTargetTeam"("teamRefId");
ALTER TABLE "FlowTargetTeam"
    ADD CONSTRAINT "FlowTargetTeam_flowId_fkey"
    FOREIGN KEY ("flowId") REFERENCES "Flow"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowTargetTeam"
    ADD CONSTRAINT "FlowTargetTeam_teamRefId_fkey"
    FOREIGN KEY ("teamRefId") REFERENCES "TeamRef"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- FlowTargetPerson ----------
CREATE TABLE "FlowTargetPerson" (
    "flowId"      TEXT         NOT NULL,
    "personRefId" TEXT         NOT NULL,
    "assignedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowTargetPerson_pkey" PRIMARY KEY ("flowId", "personRefId")
);
CREATE INDEX "FlowTargetPerson_personRefId_idx" ON "FlowTargetPerson"("personRefId");
ALTER TABLE "FlowTargetPerson"
    ADD CONSTRAINT "FlowTargetPerson_flowId_fkey"
    FOREIGN KEY ("flowId") REFERENCES "Flow"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FlowTargetPerson"
    ADD CONSTRAINT "FlowTargetPerson_personRefId_fkey"
    FOREIGN KEY ("personRefId") REFERENCES "PersonRef"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Attempt.externalPersonId ----------
ALTER TABLE "Attempt"
    ADD COLUMN "externalPersonId" TEXT;
CREATE INDEX "Attempt_externalPersonId_idx" ON "Attempt"("externalPersonId");
