import { Router } from 'express';
import { prisma } from '../db.js';
import { handle } from '../asyncHandler.js';

// PUBLIC email open-tracking endpoint (mounted at /api/track, NOT cookie-gated
// — the recipient's mail client fetches it). The tracking id is a 16-byte
// random token unique per GOS-sent message; nothing else is exposed.
//
// Honesty note (by design, surfaced in the UI too): opens are best-effort.
// Gmail's image proxy, Apple Mail Privacy Protection and blockers can inflate
// or hide opens — this is a signal, never proof a human read the mail.

const router = Router();

// Smallest valid transparent GIF (43 bytes).
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

router.get(
  '/email-open/:trackingId.gif',
  handle(async (req, res) => {
    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    });

    const trackingId = String(req.params.trackingId || '');
    // Self-open filter: requests carrying a valid GOS admin session are our own
    // team previewing the sent mail inside the app — don't count those.
    // (The sender opening it in Gmail itself is NOT reliably detectable.)
    const isSelf = !!req.adminAuth?.userId;

    if (trackingId && !isSelf) {
      try {
        const message = await prisma.emailMessage.findUnique({
          where: { trackingId },
          select: { id: true, engagement: { select: { firstOpenedAt: true } } },
        });
        if (message) {
          const now = new Date();
          await prisma.emailEngagement.upsert({
            where: { messageId: message.id },
            create: { messageId: message.id, openCount: 1, firstOpenedAt: now, lastOpenedAt: now },
            update: {
              openCount: { increment: 1 },
              lastOpenedAt: now,
              // The row may pre-exist from send time with a null firstOpenedAt.
              ...(message.engagement?.firstOpenedAt ? {} : { firstOpenedAt: now }),
            },
          });
        }
      } catch (e) {
        // Tracking must NEVER break pixel delivery.
        console.error('[email-track] failed:', e?.message);
      }
    }
    res.end(PIXEL);
  }),
);

export default router;
