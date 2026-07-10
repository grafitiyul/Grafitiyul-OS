-- CreateTable
CREATE TABLE "QuestionnaireTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audience" TEXT NOT NULL DEFAULT 'staff',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'he',
    "supportedLanguages" TEXT[] DEFAULT ARRAY['he']::TEXT[],
    "singletonPerSubject" BOOLEAN NOT NULL DEFAULT true,
    "allowResumeOnOldVersion" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "intro" JSONB,
    "outro" JSONB,
    "displayMode" TEXT NOT NULL DEFAULT 'full_list',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireSection" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "collapsible" BOOLEAN NOT NULL DEFAULT false,
    "collapsedByDefault" BOOLEAN NOT NULL DEFAULT false,
    "visibleWhen" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireQuestion" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" JSONB NOT NULL,
    "helpText" JSONB,
    "placeholder" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "visibleWhen" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireQuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireQuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireSubmission" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "language" TEXT NOT NULL DEFAULT 'he',
    "submittedByType" TEXT NOT NULL DEFAULT 'staff',
    "submittedByRef" TEXT,
    "submittedByName" TEXT,
    "linkId" TEXT,
    "subjectSnapshot" JSONB,
    "meta" JSONB,
    "singletonKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireAnswer" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT,
    "questionKey" TEXT NOT NULL,
    "value" JSONB,
    "questionSnapshot" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnaireLink" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "purpose" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "language" TEXT,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3),
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionnairePurposeConfig" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnairePurposeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireTemplate_key_key" ON "QuestionnaireTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireTemplate_currentVersionId_key" ON "QuestionnaireTemplate"("currentVersionId");

-- CreateIndex
CREATE INDEX "QuestionnaireTemplate_purpose_status_idx" ON "QuestionnaireTemplate"("purpose", "status");

-- CreateIndex
CREATE INDEX "QuestionnaireVersion_templateId_status_idx" ON "QuestionnaireVersion"("templateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireVersion_templateId_versionNo_key" ON "QuestionnaireVersion"("templateId", "versionNo");

-- CreateIndex
CREATE INDEX "QuestionnaireSection_versionId_sortOrder_idx" ON "QuestionnaireSection"("versionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireSection_versionId_key_key" ON "QuestionnaireSection"("versionId", "key");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestion_sectionId_sortOrder_idx" ON "QuestionnaireQuestion"("sectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestion_versionId_idx" ON "QuestionnaireQuestion"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireQuestion_versionId_key_key" ON "QuestionnaireQuestion"("versionId", "key");

-- CreateIndex
CREATE INDEX "QuestionnaireQuestionOption_questionId_sortOrder_idx" ON "QuestionnaireQuestionOption"("questionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireQuestionOption_questionId_value_key" ON "QuestionnaireQuestionOption"("questionId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireSubmission_singletonKey_key" ON "QuestionnaireSubmission"("singletonKey");

-- CreateIndex
CREATE INDEX "QuestionnaireSubmission_subjectType_subjectId_purpose_statu_idx" ON "QuestionnaireSubmission"("subjectType", "subjectId", "purpose", "status");

-- CreateIndex
CREATE INDEX "QuestionnaireSubmission_templateId_status_idx" ON "QuestionnaireSubmission"("templateId", "status");

-- CreateIndex
CREATE INDEX "QuestionnaireSubmission_versionId_idx" ON "QuestionnaireSubmission"("versionId");

-- CreateIndex
CREATE INDEX "QuestionnaireAnswer_questionId_idx" ON "QuestionnaireAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireAnswer_submissionId_questionKey_key" ON "QuestionnaireAnswer"("submissionId", "questionKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireLink_token_key" ON "QuestionnaireLink"("token");

-- CreateIndex
CREATE INDEX "QuestionnaireLink_subjectType_subjectId_purpose_idx" ON "QuestionnaireLink"("subjectType", "subjectId", "purpose");

-- CreateIndex
CREATE INDEX "QuestionnaireLink_templateId_idx" ON "QuestionnaireLink"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnairePurposeConfig_purpose_key" ON "QuestionnairePurposeConfig"("purpose");

-- AddForeignKey
ALTER TABLE "QuestionnaireTemplate" ADD CONSTRAINT "QuestionnaireTemplate_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "QuestionnaireVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireVersion" ADD CONSTRAINT "QuestionnaireVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuestionnaireTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireSection" ADD CONSTRAINT "QuestionnaireSection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuestionnaireVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireQuestion" ADD CONSTRAINT "QuestionnaireQuestion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuestionnaireVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireQuestion" ADD CONSTRAINT "QuestionnaireQuestion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "QuestionnaireSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireQuestionOption" ADD CONSTRAINT "QuestionnaireQuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionnaireQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireSubmission" ADD CONSTRAINT "QuestionnaireSubmission_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuestionnaireTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireSubmission" ADD CONSTRAINT "QuestionnaireSubmission_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "QuestionnaireVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireSubmission" ADD CONSTRAINT "QuestionnaireSubmission_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "QuestionnaireLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "QuestionnaireSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionnaireQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireLink" ADD CONSTRAINT "QuestionnaireLink_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuestionnaireTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnairePurposeConfig" ADD CONSTRAINT "QuestionnairePurposeConfig_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuestionnaireTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

