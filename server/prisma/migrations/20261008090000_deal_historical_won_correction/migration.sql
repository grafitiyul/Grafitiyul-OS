-- Historical WON correction ("הפוך ל-WON שקט"): a deliberate, audited
-- back-office fix for a deal that really happened and was really paid years
-- ago but was never closed in the CRM.
--
-- historicalWonAt is the marker — its presence is the ONE explicit exemption
-- from the "WON without tour" safety detector, so a genuinely broken WON still
-- raises while an intentionally tour-less historical correction does not.
-- historicalWonNote freezes the operator's choices for the audit trail.
--
-- Both nullable and additive: every existing row keeps behaving exactly as
-- before, and nothing financial is implied by either column.
ALTER TABLE "Deal" ADD COLUMN "historicalWonAt" TIMESTAMP(3);
ALTER TABLE "Deal" ADD COLUMN "historicalWonNote" JSONB;
