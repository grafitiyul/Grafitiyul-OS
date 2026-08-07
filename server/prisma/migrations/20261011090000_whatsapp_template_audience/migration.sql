-- WhatsApp template AUDIENCE — who a reusable wording row is written for.
--
-- The existing library is customer wording (the Deal / inbox "תבנית ווטסאפ"
-- picker). The Management-Tasks "הודעה למדריך" flow needs the same thing for
-- GUIDES: same storage, same editor, same chip convention, same language pair,
-- same ordering — only a different variable set and a different picker.
--
-- One column instead of a second table. Every existing row is customer wording
-- by definition, which is exactly what the NOT NULL DEFAULT backfills, so this
-- migration cannot change the behaviour of anything already shipped.
ALTER TABLE "WhatsAppTemplate" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'customer';

-- The guide picker reads (audience, isActive) ordered by sortOrder — the same
-- access path the existing (isActive, sortOrder) index serves for the customer
-- picker, now scoped.
CREATE INDEX "WhatsAppTemplate_audience_isActive_sortOrder_idx"
  ON "WhatsAppTemplate"("audience", "isActive", "sortOrder");
