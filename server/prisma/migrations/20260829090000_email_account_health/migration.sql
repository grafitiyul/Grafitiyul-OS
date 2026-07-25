-- Google connection health surface on the shared org account. Gmail AND the
-- Calendar sync hang off ONE refresh token, so these fields describe the whole
-- Google connection, not just Gmail sync. All additive + nullable (health
-- defaults to 'unknown' until the first refresh/probe); no backfill needed.
ALTER TABLE "EmailAccount" ADD COLUMN "healthState" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "EmailAccount" ADD COLUMN "lastRefreshAt" TIMESTAMP(3);
ALTER TABLE "EmailAccount" ADD COLUMN "lastGmailCheckAt" TIMESTAMP(3);
ALTER TABLE "EmailAccount" ADD COLUMN "lastCalendarCheckAt" TIMESTAMP(3);
ALTER TABLE "EmailAccount" ADD COLUMN "lastAuthError" TEXT;
ALTER TABLE "EmailAccount" ADD COLUMN "lastAuthErrorAt" TIMESTAMP(3);
