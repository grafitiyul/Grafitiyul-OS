-- Per-report sending-window opt-out. Default TRUE: obeying the window is the
-- norm, immediate send is the explicit exception. Behaviour today is unchanged
-- either way, because no audience×channel policy is enabled yet.
ALTER TABLE "AdminReportConfig" ADD COLUMN "respectSendingWindow" BOOLEAN NOT NULL DEFAULT true;

-- Frozen copy on queued customer rows: the worker gates rows, not reports, and
-- a later config flip must not re-time messages already in flight.
ALTER TABLE "WhatsAppScheduledMessage" ADD COLUMN "bypassSendingWindow" BOOLEAN NOT NULL DEFAULT false;
