-- Guide Portal server-backed permissions — singleton row (id='singleton'),
-- lazily seeded on first read (same convention as TourSettings /
-- TourGallerySettings). Enforced server-side on every guide-facing
-- /api/portal route; gallery delete/share stay on TourGallerySettings.

-- CreateTable
CREATE TABLE "GuidePortalSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "viewTeam" BOOLEAN NOT NULL DEFAULT true,
    "viewParticipantPhone" BOOLEAN NOT NULL DEFAULT true,
    "viewParticipantEmail" BOOLEAN NOT NULL DEFAULT true,
    "viewCustomerInfo" BOOLEAN NOT NULL DEFAULT true,
    "viewFieldRep" BOOLEAN NOT NULL DEFAULT true,
    "fillTourSummary" BOOLEAN NOT NULL DEFAULT true,
    "useTourGallery" BOOLEAN NOT NULL DEFAULT true,
    "useCoordinationForms" BOOLEAN NOT NULL DEFAULT true,
    "viewPastTours" BOOLEAN NOT NULL DEFAULT true,
    "viewPay" BOOLEAN NOT NULL DEFAULT true,
    "viewProcedures" BOOLEAN NOT NULL DEFAULT true,
    "viewTraining" BOOLEAN NOT NULL DEFAULT true,
    "editPersonalProfile" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuidePortalSettings_pkey" PRIMARY KEY ("id")
);
