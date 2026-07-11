-- Product decision (2026-07): "סיורי עבר" is a permanent Guide Portal tab,
-- not permission-gated content. Completed-tour visibility follows the live
-- TourAssignment (removal still revokes everything) — the obsolete
-- GuidePortalSettings.viewPastTours switch is removed end-to-end.
ALTER TABLE "GuidePortalSettings" DROP COLUMN "viewPastTours";
