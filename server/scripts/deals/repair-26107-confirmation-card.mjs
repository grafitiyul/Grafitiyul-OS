// Repair for Deal #26107: it became WON (2026-08-04 12:09 UTC) but its
// confirmation email was never queued (the WON hook's auto-send failed
// silently — the systemic fix now raises a review card on such failures).
// NO customer email is sent here: the canonical review card is raised so the
// office explicitly reviews and sends from the preview.
// Run: DATABASE_URL=<prod> node server/scripts/deals/repair-26107-confirmation-card.mjs --apply
import { PrismaClient } from '@prisma/client';
import { createReviewItem } from '../../src/reviewItems/service.js';
import { CONFIRMATION_EMAIL_REVIEW_KIND } from '../../src/reviewItems/kinds/confirmationEmailReview.js';
import { wonTransitionKey } from '../../src/deals/wonTransition.js';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const deal = await prisma.deal.findUnique({
  where: { orderNo: 26107 },
  select: { id: true, orderNo: true, status: true, wonAt: true, organization: { select: { name: true } }, contacts: { select: { contact: { select: { firstNameHe: true, lastNameHe: true } } }, orderBy: { isPrimary: 'desc' }, take: 1 } },
});
if (!deal || deal.status !== 'won') { console.log('deal missing or not won — abort'); process.exit(1); }

const already = await prisma.confirmationEmailSend.findFirst({ where: { dealId: deal.id } });
if (already) { console.log('a confirmation email already exists — nothing to repair'); process.exit(0); }

const c = deal.contacts?.[0]?.contact;
const label = deal.organization?.name || [c?.firstNameHe, c?.lastNameHe].filter(Boolean).join(' ') || 'לקוח';
const key = `${CONFIRMATION_EMAIL_REVIEW_KIND}:${wonTransitionKey(deal.id, deal.wonAt)}`;
console.log(`will create review card for #${deal.orderNo} (${label}), dedupeKey=${key} ${APPLY ? '' : '(dry-run)'}`);
if (APPLY) {
  const { created } = await createReviewItem({
    kind: CONFIRMATION_EMAIL_REVIEW_KIND,
    dedupeKey: key,
    title: `מייל אישור לא נשלח אוטומטית — ${label} (#${deal.orderNo})`,
    summary: 'העסקה נסגרה (WON) אך מייל האישור לא נכנס לתור בעת הסגירה. פתחו תצוגה מקדימה, בדקו ושלחו.',
    data: { orderNo: deal.orderNo, autoSendError: 'missed_at_won', backfill: true },
    entityRefs: [{ type: 'deal', id: deal.id, orderNo: deal.orderNo, label }],
    dealId: deal.id,
  }, { db: prisma });
  console.log('card created:', created);
}
await prisma.$disconnect();
