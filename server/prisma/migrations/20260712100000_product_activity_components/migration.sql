-- Product default Activity Components (Tours module, Slice B). A Product declares
-- an ORDERED set of default activity components; these are copied onto a
-- TourEvent at creation (Slice C). Purely additive — new join table only.
-- ON DELETE Restrict on the component protects a referenced catalog entry from
-- hard-deletion (the API deactivates instead); Cascade on the product cleans up
-- the links when a product is removed.

CREATE TABLE IF NOT EXISTS "ProductActivityComponent" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "activityComponentId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductActivityComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductActivityComponent_productId_activityComponentId_key" ON "ProductActivityComponent"("productId", "activityComponentId");
CREATE INDEX IF NOT EXISTS "ProductActivityComponent_productId_idx" ON "ProductActivityComponent"("productId");
CREATE INDEX IF NOT EXISTS "ProductActivityComponent_activityComponentId_idx" ON "ProductActivityComponent"("activityComponentId");

ALTER TABLE "ProductActivityComponent"
  ADD CONSTRAINT "ProductActivityComponent_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductActivityComponent"
  ADD CONSTRAINT "ProductActivityComponent_activityComponentId_fkey"
  FOREIGN KEY ("activityComponentId") REFERENCES "ActivityComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
