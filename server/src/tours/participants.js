// Tour participant composition for the TABLE (customer names) and the tour
// MODAL (per-customer purchased-ticket breakdown + aggregate). Every number
// derives from the CANONICAL TicketRegistration rows (seat SSOT) — never from a
// tour snapshot — and the breakdown dimensions are whatever the registrations
// actually carry (nothing about "workshop" or "adult/child" is hardcoded).

import { CAPACITY_STATUSES, CONFIRMED_STATUSES, isHeld } from './registrationStatus.js';
import { dealBookerLabel } from './customerDisplay.js';
import { aggregateBreakdowns } from '../deals/groupOffering.js';

// The lean select every participant read shares: the booker label fields + the
// seat/composition fields + status (to split confirmed vs held).
export const PARTICIPANT_REGISTRATION_SELECT = {
  tourEventId: true,
  status: true,
  quantity: true,
  ticketBreakdown: true,
  customerName: true,
  createdAt: true,
  deal: {
    select: {
      title: true,
      organization: { select: { name: true } },
      contacts: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 1,
        select: {
          contact: {
            select: { firstNameHe: true, lastNameHe: true, firstNameEn: true, lastNameEn: true },
          },
        },
      },
    },
  },
};

// Batch-fetch the capacity-consuming registrations (confirmed + held) for a set
// of tours, in a stable order. Returns the raw rows; callers shape them.
export async function fetchTourParticipantRegistrations(prisma, tourEventIds) {
  const ids = [...new Set(tourEventIds)].filter(Boolean);
  if (!ids.length) return [];
  return prisma.ticketRegistration.findMany({
    where: { tourEventId: { in: ids }, status: { in: CAPACITY_STATUSES } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: PARTICIPANT_REGISTRATION_SELECT,
  });
}

// The display label for one registration: the deal booker ("contact · org"), or
// the row's own customerName (website rows), else null.
function registrationLabel(reg) {
  return dealBookerLabel(reg.deal) || (reg.customerName || '').trim() || null;
}

// PURE. ALL distinct customer names on a tour, comma-rendered by the client with
// natural wrapping (no "+N"). A name is HELD only when EVERY registration under
// it is held — any confirmed seat makes the customer confirmed. Order = first
// appearance (stable createdAt order). → [{ label, held }]
export function tourCustomerNames(registrationRows) {
  const byLabel = new Map(); // label → { label, held }
  for (const r of registrationRows) {
    const label = registrationLabel(r);
    if (!label) continue;
    const confirmed = CONFIRMED_STATUSES.includes(r.status);
    const e = byLabel.get(label);
    if (!e) byLabel.set(label, { label, held: !confirmed });
    else if (confirmed) e.held = false;
  }
  return [...byLabel.values()];
}

// PURE. The tour MODAL breakdown: a per-customer list (each with its own ticket
// composition + a held flag) plus the tour-level aggregate. Generic — only the
// dimensions present in the data appear. →
//   { aggregate: { total, byCard, byTicketType },
//     customers: [{ label, held, quantity, breakdown: [{cardTitle,ticketLabel,quantity,...}] }] }
export function tourParticipantBreakdown(registrationRows) {
  const customers = [];
  for (const r of registrationRows) {
    const label = registrationLabel(r);
    const breakdown = Array.isArray(r.ticketBreakdown) ? r.ticketBreakdown : [];
    const quantity = breakdown.length
      ? breakdown.reduce((n, b) => n + (Number(b.quantity) || 0), 0)
      : Number(r.quantity) || 0;
    customers.push({
      label: label || 'ללא שם',
      held: isHeld(r.status),
      quantity,
      breakdown: breakdown.map((b) => ({
        cardGroupId: b.cardGroupId || null,
        cardTitle: b.cardTitle || null,
        ticketTypeId: b.ticketTypeId || null,
        ticketLabel: b.ticketLabel || null,
        quantity: Number(b.quantity) || 0,
      })),
    });
  }
  return { aggregate: aggregateBreakdowns(registrationRows), customers };
}
