-- "מספר הזמנה" — business-facing sequential Deal number.
-- A dedicated sequence starting at 27000; numbers only grow and are never
-- reused (gaps from deleted deals are fine). Existing deals are backfilled in
-- creation order, then the sequence is positioned above the highest assigned
-- number so new deals continue from there.
CREATE SEQUENCE "deal_order_no_seq" START WITH 27000;

ALTER TABLE "Deal" ADD COLUMN "orderNo" INTEGER;

UPDATE "Deal" AS d
SET "orderNo" = s."rn"
FROM (
  SELECT "id", 26999 + ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "rn"
  FROM "Deal"
) AS s
WHERE d."id" = s."id";

-- Continue numbering after the backfill (27000 exactly when the table is empty).
SELECT setval(
  'deal_order_no_seq',
  GREATEST(27000, COALESCE((SELECT MAX("orderNo") FROM "Deal"), 26999) + 1),
  false
);

ALTER TABLE "Deal" ALTER COLUMN "orderNo" SET NOT NULL;
ALTER TABLE "Deal" ALTER COLUMN "orderNo" SET DEFAULT nextval('deal_order_no_seq');

CREATE UNIQUE INDEX "Deal_orderNo_key" ON "Deal"("orderNo");

-- Drop the sequence automatically if the column is ever dropped.
ALTER SEQUENCE "deal_order_no_seq" OWNED BY "Deal"."orderNo";
