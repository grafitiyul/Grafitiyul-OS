-- Confirmation Email special texts — office-curated wording options selected
-- per-deal (first category: cancellation policies). Generic category model;
-- future wording categories are registry entries, never new tables.

-- CreateTable
CREATE TABLE "ConfirmationSpecialText" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "internalNote" TEXT,
    "bodyHe" TEXT,
    "bodyEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfirmationSpecialText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfirmationSpecialText_category_active_sortOrder_idx" ON "ConfirmationSpecialText"("category", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "ConfirmationSpecialText_category_isDefault_idx" ON "ConfirmationSpecialText"("category", "isDefault");
