-- Canonical purchased ticket composition on the registration (from the Group
-- Ticket Builder quote lines). Purely additive; the operational variant is the
-- dominant card variant derived from it, so a plain-only deal never inherits a
-- stale workshop tour-variant snapshot.
ALTER TABLE "TicketRegistration" ADD COLUMN IF NOT EXISTS "ticketBreakdown" JSONB;
