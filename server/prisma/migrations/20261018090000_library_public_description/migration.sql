-- Localized public description for a Content Library item.
--
-- FULLY ADDITIVE: two nullable columns, no data touched.
--
-- WHY: the bilingual audit (2026-08-08) found the Content API returning
-- LibraryItem.description — the column the schema marks "Internal notes —
-- never customer-facing" — to external consumer systems, because there was no
-- public description to return instead. These columns give consumers a real
-- localized description, and the internal notes stop leaving GOS.

-- AlterTable
ALTER TABLE "LibraryItem" ADD COLUMN     "publicDescriptionEn" TEXT,
ADD COLUMN     "publicDescriptionHe" TEXT;

