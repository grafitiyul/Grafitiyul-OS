-- Avatar worker probe classification + scheduling (2026-07-30).
-- status 'stored'/'none'/'error'; attempts counts consecutive transient
-- failures; nextCheckAt is the one scheduling gate (stored/none → +30d,
-- error → bounded exponential backoff capped at 30d). Confirmed no-picture
-- results are persisted so the same chat is never hammered.
ALTER TABLE "WhatsAppChat" ADD COLUMN "profilePictureStatus" TEXT;
ALTER TABLE "WhatsAppChat" ADD COLUMN "profilePictureAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppChat" ADD COLUMN "profilePictureNextCheckAt" TIMESTAMP(3);
