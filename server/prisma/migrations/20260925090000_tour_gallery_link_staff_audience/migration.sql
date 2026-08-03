-- Guide-scoped gallery upload links: the same TourGalleryLink capability model
-- gains an audience ('customer' | 'staff'). Staff links belong to ONE guide
-- (personRefId) and power the direct photo-upload link in the tour-summary
-- WhatsApp reminders (#14-#16). Existing rows are customer links.
ALTER TABLE "TourGalleryLink" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE "TourGalleryLink" ADD COLUMN "personRefId" TEXT;
