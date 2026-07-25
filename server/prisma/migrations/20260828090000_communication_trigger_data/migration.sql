-- Trigger-carried payload frozen onto each delivery at fire time (change
-- details, explicit quote identity). Additive; audit rows keep it forever.
ALTER TABLE "CommunicationDelivery" ADD COLUMN "triggerData" JSONB;
