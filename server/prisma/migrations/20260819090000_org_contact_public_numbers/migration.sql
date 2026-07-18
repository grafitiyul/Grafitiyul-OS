-- Stable public numeric identifiers for Organization ("מספר ארגון") and
-- Contact ("מספר איש קשר") — the deal_order_no_seq pattern.
--
-- Every NEW row automatically receives a number from a dedicated sequence
-- (the DEFAULT is added AFTER the column, so existing rows are NOT rewritten
-- and deliberately stay NULL). A separate legacy-migration content backfill
-- assigns imported rows their original Pipedrive ids; the sequence starts are
-- collision-safe above them (max legacy org id 3,053 < 10000; max legacy
-- person id 37,636 < 50000). Numbers only grow and are never reused — gaps
-- from deleted rows are fine.

-- Organization → orgNo
CREATE SEQUENCE "org_no_seq" START WITH 10000;

ALTER TABLE "Organization" ADD COLUMN "orgNo" INTEGER;
ALTER TABLE "Organization" ALTER COLUMN "orgNo" SET DEFAULT nextval('org_no_seq');

CREATE UNIQUE INDEX "Organization_orgNo_key" ON "Organization"("orgNo");

-- Drop the sequence automatically if the column is ever dropped.
ALTER SEQUENCE "org_no_seq" OWNED BY "Organization"."orgNo";

-- Contact → contactNo
CREATE SEQUENCE "contact_no_seq" START WITH 50000;

ALTER TABLE "Contact" ADD COLUMN "contactNo" INTEGER;
ALTER TABLE "Contact" ALTER COLUMN "contactNo" SET DEFAULT nextval('contact_no_seq');

CREATE UNIQUE INDEX "Contact_contactNo_key" ON "Contact"("contactNo");

ALTER SEQUENCE "contact_no_seq" OWNED BY "Contact"."contactNo";
