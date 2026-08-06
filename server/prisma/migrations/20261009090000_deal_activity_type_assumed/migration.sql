-- Deal.activityTypeAssumedAt — records that the system RESOLVED activityType
-- (deals/resolveActivityType.js) because a payment closed the deal while the
-- field was still empty. Additive and nullable: every existing row keeps its
-- current classification and reads as operator-chosen, which is what it is.
ALTER TABLE "Deal" ADD COLUMN "activityTypeAssumedAt" TIMESTAMP(3);
