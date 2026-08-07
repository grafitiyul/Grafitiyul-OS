-- Activity-type CONVERSION — the idempotency identity of the operation.
--
-- Converting a Deal between activity types cancels a booking, releases seats,
-- creates or joins a tour and reconciles scheduled communications. A double
-- click, a browser refresh, a worker retry or a re-opened modal must never run
-- that twice. `conversionOpId` is a client-supplied UUID; the UNIQUE index is
-- what makes "has this exact conversion already been performed?" a question the
-- DATABASE answers, not the application.
--
-- Nullable + additive: every existing row is simply "never converted".
ALTER TABLE "Deal" ADD COLUMN "conversionOpId" TEXT;

CREATE UNIQUE INDEX "Deal_conversionOpId_key" ON "Deal"("conversionOpId");
