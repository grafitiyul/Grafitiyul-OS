-- Outbound pacing slot per WhatsApp account (GOS-owned; the bridge never
-- writes this column). whatsapp/sendPace.js claims the next automated-send
-- slot by pushing this stamp forward one gap at a time, so every automated
-- sender shares ONE queue per number instead of pacing itself privately.
--
-- Nullable with no default: NULL means "no send has been paced yet", which the
-- claim statement treats as now(). Backfilling a value would delay the first
-- send after deploy for no reason.
ALTER TABLE "WhatsAppAccount" ADD COLUMN "nextSendSlotAt" TIMESTAMP(3);
