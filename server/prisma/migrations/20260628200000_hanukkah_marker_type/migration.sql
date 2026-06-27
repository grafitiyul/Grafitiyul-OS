-- Add the Hanukkah calendar-marker type (operational; NOT pricing).
--
-- ADDITIVE. One seed row in CalendarMarkerType so the Hebcal import can attach
-- Hanukkah day markers. 'system' source = the import depends on it (not
-- hard-deletable). Idempotent via ON CONFLICT on the unique key. No pricing,
-- HolidayRule, or schema changes.

INSERT INTO "CalendarMarkerType" ("id","key","nameHe","nameEn","color","active","sortOrder","source","createdAt","updatedAt")
VALUES ('markertype_hanukkah','hanukkah','חנוכה','Hanukkah','#14b8a6', true, 5, 'system', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
