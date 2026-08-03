// Management Tasks ("משימות הנהלה") — the operational review inbox.

import { Router } from 'express';
import { handle } from '../asyncHandler.js';
import { prisma } from '../db.js';
import { loadInbox, handleReviewItem, reopenReviewItem, openCounts } from '../reviewItems/service.js';
import { listReviewKinds, reviewKindDef } from '../reviewItems/registry.js';
import { guideGalleryUploadUrl } from '../tours/gallery/links.js';
import '../reviewItems/kinds/index.js';

const router = Router();

async function actingAdmin(req) {
  const userId = req.adminAuth?.userId || null;
  if (!userId) return { id: null, name: null };
  const u = await prisma.adminUser.findUnique({
    where: { id: userId },
    select: { username: true, displayName: true },
  });
  return { id: userId, name: u?.displayName || u?.username || null };
}

/** Card kinds + their meaning — the same self-documenting rule as בקרה. */
router.get('/kinds', handle(async (_req, res) => {
  res.json({
    kinds: listReviewKinds().map(({ kind, labelHe, tone, descriptionHe }) => ({
      kind, labelHe, tone, descriptionHe,
    })),
  });
}));

router.get('/', handle(async (req, res) => {
  const status = req.query.status === 'handled' ? 'handled' : 'open';
  const inbox = await loadInbox({ status });
  // Deep links come from the kind definition, never hardcoded in the client.
  for (const group of inbox.groups) {
    for (const card of group.cards) {
      card.link = reviewKindDef(card.kind)?.buildLink?.(card) || null;
      card.tone = reviewKindDef(card.kind)?.tone || 'default';
      card.kindLabelHe = reviewKindDef(card.kind)?.labelHe || card.kind;
      // Tour Summary cards carry the SAME direct photo-upload/gallery link the
      // guide received in WhatsApp (idempotent mint — reuses the sent one), so
      // the office jumps straight to the uploaded photos. Resolved at read
      // time, never frozen: revocation/cancellation must always win.
      if (card.kind === 'tour_summary' && card.tourEventId) {
        card.galleryUrl = await guideGalleryUploadUrl(prisma, {
          tourEventId: card.tourEventId,
          personRefId: card.personRefId || card.data?.guidePersonRefId || null,
        });
      }
    }
  }
  res.json(inbox);
}));

router.get('/counts', handle(async (_req, res) => {
  res.json({ open: await openCounts() });
}));

// Handling ONE card. Scoped by id and guarded on status, so a sibling card on
// the same tour is structurally untouched.
router.post('/:id/handle', handle(async (req, res) => {
  const user = await actingAdmin(req);
  const { changed } = await handleReviewItem(req.params.id, { userId: user.id, userName: user.name });
  if (!changed) return res.status(409).json({ error: 'already_handled_or_missing' });
  res.json(await loadInbox({ status: 'open' }));
}));

router.post('/:id/reopen', handle(async (req, res) => {
  const { changed } = await reopenReviewItem(req.params.id);
  if (!changed) return res.status(409).json({ error: 'not_handled_or_missing' });
  res.json(await loadInbox({ status: 'handled' }));
}));

export default router;
