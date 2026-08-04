// READ-ONLY: reproduce the WON-hook auto-send decision for a deal — which
// error (if any) sendConfirmationEmail would return. Composes only; never
// creates queue rows, snapshots or timeline entries.
// Run: DATABASE_URL=<prod> node server/scripts/deals/diagnose-confirmation-autosend.mjs 26107
import { PrismaClient } from '@prisma/client';
import { composeConfirmationEmail } from '../../src/confirmation/composer.js';
import { ACKNOWLEDGEABLE } from '../../src/confirmation/sendService.js';
import { resolveSendAccount, cleanRecipientList } from '../../src/email/composedSend.js';
import { hasActiveFillers } from '../../src/confirmation/fillers.js';

const prisma = new PrismaClient();
const orderNo = Number(process.argv[2] || 26107);
const deal = await prisma.deal.findUnique({ where: { orderNo }, select: { id: true, confirmation: { select: { fillers: true } } } });
if (!deal) { console.log('deal not found'); process.exit(1); }

console.log('fillers active:', hasActiveFillers(deal.confirmation?.fillers));

const composed = await composeConfirmationEmail(prisma, deal.id, {});
if (composed.error) {
  console.log('COMPOSE ERROR:', composed.error, JSON.stringify(composed.meta || null));
} else {
  console.log('composed ok. dealStatus =', composed.dealStatus, '| language =', composed.language, '| template =', composed.template?.internalName);
  console.log('recipient:', JSON.stringify(composed.recipient));
  const to = cleanRecipientList([{ email: composed.recipient?.email, name: composed.recipient?.name }]);
  console.log('to after clean:', JSON.stringify(to));
  const blocking = (composed.warnings || []).filter((w) => ACKNOWLEDGEABLE.has(w.code));
  console.log('warnings:', JSON.stringify(composed.warnings || []));
  console.log('BLOCKING (auto-send would stop):', JSON.stringify(blocking));
  console.log('subject:', composed.subject);
  console.log('emailHtml length:', (composed.emailHtml || '').length);
  try {
    const account = await resolveSendAccount(null);
    console.log('send account:', account?.emailAddress ?? account?.id);
  } catch (e) {
    console.log('ACCOUNT ERROR:', e.code || e.message);
  }
}
await prisma.$disconnect();
