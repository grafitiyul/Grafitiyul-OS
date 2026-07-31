-- Main-navigation configuration (org-wide). Sparse overrides keyed by the code
-- registry's module key: a module with no row keeps its code defaults, so this
-- table ships EMPTY and the navigation behaves exactly as the code says until
-- an administrator saves /admin/settings/navigation.

-- CreateTable: NavPreference
CREATE TABLE "NavPreference" (
    "key" TEXT NOT NULL,
    "inNav" BOOLEAN NOT NULL DEFAULT true,
    "railGroup" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NavPreference_pkey" PRIMARY KEY ("key")
);
