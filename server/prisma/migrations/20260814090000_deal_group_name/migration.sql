-- "Group Name" — dedicated business field on the Deal (agent reservations,
-- binding decision #6). Seeded from the reservation group's name; then
-- independently editable (NOT an internal copy of title). Purely additive.
ALTER TABLE "Deal" ADD COLUMN "groupName" TEXT;
