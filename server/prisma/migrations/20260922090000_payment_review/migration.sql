-- Payment-review classification (deposit-vs-full-payment audit).
-- Additive only: new nullable columns + one index. No data is touched.
ALTER TABLE "Deal"
  ADD COLUMN "paymentReviewStatus"   TEXT,
  ADD COLUMN "paymentReviewSource"   TEXT,
  ADD COLUMN "paymentReviewEvidence" JSONB,
  ADD COLUMN "paymentReviewAt"       TIMESTAMP(3),
  ADD COLUMN "paymentReviewBy"       TEXT;

CREATE INDEX "Deal_status_paymentReviewStatus_idx" ON "Deal"("status", "paymentReviewStatus");
