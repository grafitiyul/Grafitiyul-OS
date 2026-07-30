-- R2-backed profile-picture cache (avatar worker, 2026-07-30).
-- profilePictureKey: our own copy under whatsapp/<accountId>/avatars/<chatId>.jpg
--   (stable key — refresh overwrites; one object per chat, purge-contract safe).
-- profilePictureCheckedAt: last probe stamp, including "no picture" outcomes,
--   so the 1-chat-per-minute worker never re-hammers the same chat inside the
--   refresh window. The raw CDN URL column stays as a fallback but expires.
ALTER TABLE "WhatsAppChat" ADD COLUMN "profilePictureKey" TEXT;
ALTER TABLE "WhatsAppChat" ADD COLUMN "profilePictureCheckedAt" TIMESTAMP(3);
