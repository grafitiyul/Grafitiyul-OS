-- Guide-audience admin reports: a delivery may address ONE PERSON by phone
-- instead of the report's configured group chat. Additive and nullable —
-- every existing group delivery keeps behaving exactly as before.
ALTER TABLE "AdminReportDelivery" ADD COLUMN "recipientPersonRefId" TEXT;
ALTER TABLE "AdminReportDelivery" ADD COLUMN "recipientPhone" TEXT;
ALTER TABLE "AdminReportDelivery" ADD COLUMN "recipientName" TEXT;
