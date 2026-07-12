-- Payroll module (שכר צוות) — data foundation. Purely ADDITIVE: six new
-- tables + seeded system components. No existing table is touched.
--
-- Design anchors (see schema.prisma comments):
--   • one PayrollEntry per person per activity (tour assignment / general)
--   • office approval lives on PayrollActivity ONLY (activity-level SSOT)
--   • calculated / override / final are separate; nothing is ever deleted —
--     cancellation is a state, history rides TimelineEntry.

-- 1. Component catalog
CREATE TABLE "PayrollComponent" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "nameHe" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "autoRule" TEXT,
    "sign" INTEGER NOT NULL DEFAULT 1,
    "vatMode" TEXT NOT NULL DEFAULT 'net',
    "scope" TEXT NOT NULL DEFAULT 'all',
    "officeAlways" BOOLEAN NOT NULL DEFAULT false,
    "guideVisible" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollComponent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollComponent_key_key" ON "PayrollComponent"("key");

-- 2. General activity type catalog
CREATE TABLE "GeneralActivityType" (
    "id" TEXT NOT NULL,
    "nameHe" TEXT NOT NULL,
    "defaultUnitPriceMinor" BIGINT NOT NULL DEFAULT 0,
    "defaultQuantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "defaultNotes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneralActivityType_pkey" PRIMARY KEY ("id")
);

-- 3. General activity occurrences
CREATE TABLE "GeneralActivity" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "titleHe" TEXT NOT NULL,
    "payrollMonth" TEXT NOT NULL,
    "date" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneralActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GeneralActivity_payrollMonth_idx" ON "GeneralActivity"("payrollMonth");
ALTER TABLE "GeneralActivity"
  ADD CONSTRAINT "GeneralActivity_typeId_fkey"
  FOREIGN KEY ("typeId") REFERENCES "GeneralActivityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Payroll activity (office-approval SSOT, drawer subject)
CREATE TABLE "PayrollActivity" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "tourEventId" TEXT,
    "generalActivityId" TEXT,
    "titleHe" TEXT NOT NULL,
    "payrollMonth" TEXT NOT NULL,
    "date" TEXT,
    "state" TEXT NOT NULL DEFAULT 'active',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "officeApprovedAt" TIMESTAMP(3),
    "officeApprovedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollActivity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollActivity_tourEventId_key" ON "PayrollActivity"("tourEventId");
CREATE UNIQUE INDEX "PayrollActivity_generalActivityId_key" ON "PayrollActivity"("generalActivityId");
CREATE INDEX "PayrollActivity_payrollMonth_idx" ON "PayrollActivity"("payrollMonth");
CREATE INDEX "PayrollActivity_date_idx" ON "PayrollActivity"("date");
CREATE INDEX "PayrollActivity_state_status_idx" ON "PayrollActivity"("state", "status");
ALTER TABLE "PayrollActivity"
  ADD CONSTRAINT "PayrollActivity_tourEventId_fkey"
  FOREIGN KEY ("tourEventId") REFERENCES "TourEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayrollActivity"
  ADD CONSTRAINT "PayrollActivity_generalActivityId_fkey"
  FOREIGN KEY ("generalActivityId") REFERENCES "GeneralActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Payroll entries
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "personRefId" TEXT,
    "externalPersonId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT,
    "tourAssignmentId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'active',
    "guideStatus" TEXT NOT NULL DEFAULT 'pending',
    "guideApprovedAt" TIMESTAMP(3),
    "vatStatusSnapshot" TEXT NOT NULL DEFAULT 'exempt',
    "vatRateSnapshot" INTEGER NOT NULL DEFAULT 18,
    "calcSnapshot" JSONB,
    "engineVersion" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollEntry_activityId_externalPersonId_key" ON "PayrollEntry"("activityId", "externalPersonId");
CREATE INDEX "PayrollEntry_externalPersonId_idx" ON "PayrollEntry"("externalPersonId");
CREATE INDEX "PayrollEntry_personRefId_idx" ON "PayrollEntry"("personRefId");
ALTER TABLE "PayrollEntry"
  ADD CONSTRAINT "PayrollEntry_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "PayrollActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollEntry"
  ADD CONSTRAINT "PayrollEntry_personRefId_fkey"
  FOREIGN KEY ("personRefId") REFERENCES "PersonRef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6. Payroll entry lines
CREATE TABLE "PayrollEntryLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "componentNameHe" TEXT NOT NULL,
    "sign" INTEGER NOT NULL DEFAULT 1,
    "vatMode" TEXT NOT NULL DEFAULT 'net',
    "quantity" DECIMAL(10,2),
    "unitPriceMinor" BIGINT,
    "calculatedMinor" BIGINT,
    "overrideMinor" BIGINT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollEntryLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollEntryLine_entryId_componentId_key" ON "PayrollEntryLine"("entryId", "componentId");
CREATE INDEX "PayrollEntryLine_entryId_idx" ON "PayrollEntryLine"("entryId");
ALTER TABLE "PayrollEntryLine"
  ADD CONSTRAINT "PayrollEntryLine_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "PayrollEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollEntryLine"
  ADD CONSTRAINT "PayrollEntryLine_componentId_fkey"
  FOREIGN KEY ("componentId") REFERENCES "PayrollComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Seed system components (stable ids, idempotent). Auto rules the engine
-- implements today; weekend/participant amounts start at 0 until configured
-- in the catalog (honest default — never invent pay).
INSERT INTO "PayrollComponent"
  ("id", "key", "nameHe", "kind", "autoRule", "sign", "vatMode", "scope", "officeAlways", "guideVisible", "config", "isSystem", "active", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('payc_base',        'base',              'תשלום בסיס',      'auto',   'base',              1,  'net', 'tour',    false, true, NULL,                                              true, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_general',     'general_quantity',  'תשלום פעילות',    'auto',   'general_quantity',  1,  'net', 'general', false, true, NULL,                                              true, true, 15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_weekend',     'weekend_holiday',   'שבת / חג',        'auto',   'weekend_holiday',   1,  'net', 'tour',    false, true, '{"amountMinor": 0}',                              true, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_participants','participant_bonus', 'בונוס משתתפים',   'auto',   'participant_bonus', 1,  'net', 'tour',    false, true, '{"fromParticipants": null, "perExtraMinor": 0}',  true, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_seniority',   'seniority',         'ותק',             'auto',   'seniority',         1,  'net', 'tour',    false, true, NULL,                                              true, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_travel',      'travel',            'נסיעות',          'auto',   'travel',            1,  'none','tour',    false, true, NULL,                                              true, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_addition',    'addition',          'תוספת',           'manual', NULL,                1,  'net', 'all',     true,  true, NULL,                                              true, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_deduction',   'deduction',         'ניכוי',           'manual', NULL,                -1, 'net', 'all',     true,  true, NULL,                                              true, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('payc_adjustment',  'adjustment',        'התאמה כללית',     'manual', NULL,                1,  'net', 'all',     true,  true, NULL,                                              true, true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
