-- CRM list performance: supporting indexes for the paginated list endpoints.
--
-- ADDITIVE ONLY (CREATE INDEX IF NOT EXISTS). No data change, no column change.
-- These serve the default sort of each list screen so a paginated `take 50`
-- reads an ordered index instead of sorting the whole table:
--   Deals    ORDER BY "updatedAt" DESC
--   Contacts ORDER BY "lastNameHe" ASC, "firstNameHe" ASC
-- Organizations already has an index on "name" (its sort key).

CREATE INDEX IF NOT EXISTS "Deal_updatedAt_idx" ON "Deal" ("updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "Contact_lastNameHe_firstNameHe_idx"
  ON "Contact" ("lastNameHe", "firstNameHe");
