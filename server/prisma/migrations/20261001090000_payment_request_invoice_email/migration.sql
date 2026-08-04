-- Tourist Cardcom — "שלח את החשבונית ללקוח לאחר התשלום".
-- ADDITIVE ONLY: two new columns on PaymentRequest, defaulted/nullable, no
-- existing data touched. The choice is frozen onto the request at
-- create/update; the outcome column is the immutable delivery audit.
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "emailInvoiceToCustomer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "invoiceEmailOutcome" TEXT;
