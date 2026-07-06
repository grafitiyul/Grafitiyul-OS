import { prisma } from '../db.js';
import { normalizeEmail } from './mime.js';
import { dealsForContact, classifyDealsForContact } from '../crm/dealResolution.js';

// Email → CRM matching. Same safety posture as WhatsApp phone matching:
// exactly ONE owning contact → link; zero → unmatched; several → ambiguous
// (manual selection required, never guess). No auto-creation of contacts.

export async function matchContactByEmails(addresses) {
  const list = [...new Set((addresses || []).map(normalizeEmail).filter(Boolean))];
  if (!list.length) return { contactId: null, ambiguous: false };
  const rows = await prisma.contactEmail.findMany({
    where: { OR: list.map((e) => ({ value: { equals: e, mode: 'insensitive' } })) },
    select: { contactId: true },
  });
  const ids = [...new Set(rows.map((r) => r.contactId))];
  if (ids.length === 1) return { contactId: ids[0], ambiguous: false };
  return { contactId: null, ambiguous: ids.length > 1 };
}

// Deal auto-link for a thread: ONLY when the contact resolves to exactly one
// safe candidate (open, or WON toured ≤7 days — shared classification).
// Anything else stays unlinked for the user to decide.
export async function resolveAutoDealId(contactId) {
  if (!contactId) return null;
  const deals = await dealsForContact(contactId);
  const outcome = classifyDealsForContact(deals);
  return outcome.kind === 'open' ? outcome.dealId : null;
}
