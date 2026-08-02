-- Customer-audience reports hand off to the shared WhatsApp queue. The delivery
-- row stays the exactly-once gate; this links it to the queue row that actually
-- sends, so the report log can show the real delivery state.
ALTER TABLE "AdminReportDelivery" ADD COLUMN "scheduledMessageId" TEXT;
