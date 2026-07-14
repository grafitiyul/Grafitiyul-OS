-- Provenance for the Woo first-publication gate:
--  * TourEvent.wooSyncOrigin — who marked the tour pending ('explicit' | 'bulk' |
--    'auto' | 'maintenance'); the worker blocks first-time publication of a
--    never-linked occurrence unless bulk sync is enabled or origin is 'explicit'.
--  * WooVariationLink.createdVia — what created the variation ('sync_one' |
--    'bulk' | 'adoption' | 'repair'); set once at creation, never overwritten.
ALTER TABLE "TourEvent" ADD COLUMN "wooSyncOrigin" TEXT;
ALTER TABLE "WooVariationLink" ADD COLUMN "createdVia" TEXT;
