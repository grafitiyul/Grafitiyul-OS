-- "דפי אתר" — GOS-managed website content pages.
-- Purely additive: two new tables, no change to any existing table.

CREATE TABLE "SitePage" (
    "id" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "pageType" TEXT NOT NULL DEFAULT 'info',
    "slug" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedVersionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "draftDirty" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "updatedByName" TEXT,

    CONSTRAINT "SitePage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SitePageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "publishedByName" TEXT,

    CONSTRAINT "SitePageVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SitePage_slug_key" ON "SitePage"("slug");
CREATE UNIQUE INDEX "SitePage_publishedVersionId_key" ON "SitePage"("publishedVersionId");
CREATE INDEX "SitePage_status_idx" ON "SitePage"("status");
CREATE INDEX "SitePage_pageType_idx" ON "SitePage"("pageType");

CREATE UNIQUE INDEX "SitePageVersion_pageId_versionNo_key" ON "SitePageVersion"("pageId", "versionNo");
CREATE INDEX "SitePageVersion_pageId_publishedAt_idx" ON "SitePageVersion"("pageId", "publishedAt");

ALTER TABLE "SitePage" ADD CONSTRAINT "SitePage_publishedVersionId_fkey"
    FOREIGN KEY ("publishedVersionId") REFERENCES "SitePageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SitePageVersion" ADD CONSTRAINT "SitePageVersion_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "SitePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
