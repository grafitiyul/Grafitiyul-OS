-- WhatsApp inbox / chat UX round:
--  * chat pin + snooze (team-level inbox workflow state)
--  * outgoing delivery acks (sent/delivered/read/played) for check indicators
--  * starred messages
ALTER TABLE "WhatsAppChat" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppChat" ADD COLUMN "snoozedUntil" TIMESTAMP(3);
ALTER TABLE "WhatsAppChat" ADD COLUMN "snoozedAt" TIMESTAMP(3);

ALTER TABLE "WhatsAppMessage" ADD COLUMN "deliveryStatus" TEXT;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "starredAt" TIMESTAMP(3);
