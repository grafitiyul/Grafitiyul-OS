-- Read-only mirror of the phone's own pin state (GOS never writes pin back).
-- Root cause 2026-07-30: a chat pinned at the top of the real WhatsApp app was
-- invisible in GOS — its last message was 5 months old, so it sorted at
-- position ~729 of 731 active chats and the inbox's take-200 cut it. The
-- provider pin now floats it like the phone does.
-- Distinct from "pinnedAt" (the GOS team's own pin).
ALTER TABLE "WhatsAppChat" ADD COLUMN "providerPinnedAt" TIMESTAMP(3);
