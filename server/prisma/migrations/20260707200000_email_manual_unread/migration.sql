-- Manual "סמן כלא נקרא" flag for email threads (GOS-side only; Gmail is never
-- written). Display state like WhatsApp's manual unread — it never inflates
-- the honest Gmail-matching unread count. ADDITIVE + defensive.
ALTER TABLE "EmailThread" ADD COLUMN IF NOT EXISTS "manualUnread" BOOLEAN NOT NULL DEFAULT false;
