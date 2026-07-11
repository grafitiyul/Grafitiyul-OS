-- Personal staff identity color — a stable palette key (shared/staffColors
-- .mjs) on PersonProfile. Nullable for legacy rows; validated server-side;
-- changelog-tracked and restorable. Tours derive their display color from
-- the assigned guide — no color is ever stored on TourEvent.

-- AlterTable
ALTER TABLE "PersonProfile" ADD COLUMN "displayColor" TEXT;
