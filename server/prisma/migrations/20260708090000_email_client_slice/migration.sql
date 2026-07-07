-- Email module → full Gmail-client slice. ADDITIVE + defensive.
--   • EmailAccount.signature   — per-account composer signature (rich HTML)
--   • EmailAttachment.contentId — RFC 2392 Content-ID for inline (cid:) images
ALTER TABLE "EmailAccount" ADD COLUMN IF NOT EXISTS "signature" TEXT;
ALTER TABLE "EmailAttachment" ADD COLUMN IF NOT EXISTS "contentId" TEXT;
