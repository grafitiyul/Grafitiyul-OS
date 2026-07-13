// Tour participant composition for the TABLE (customer names), the admin tour
// MODAL, and the GUIDE PORTAL — all from the ONE canonical TicketRegistration
// breakdown (seat SSOT), never a tour snapshot. The grouping is generic: it
// nests whatever ticket types exist under whatever products (cards) exist —
// nothing about "workshop" or "adult/child" is hardcoded. Admin + Guide Portal
// render the SAME shape from the SAME builder (no parallel breakdown logic).

import { CAPACITY_STATUSES, CONFIRMED_STATUSES, isHeld } from './registrationStatus.js';
import { dealBookerLabel } from './customerDisplay.js';

// The lean select every participant read shares: identity/matching keys + the
// booker label fields + the seat/composition fields + status.
export const PARTICIPANT_REGISTRATION_SELECT = {
  id: true,
  bookingId: true,
  dealId: true,
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

// GENERIC nested grouping — flat ticketBreakdown rows → product (card) → ticket
// types. → [{ key, label, total, ticketTypes: [{ key, label, quantity }] }].
// Only products/ticket types with a positive quantity appear (no empty rows).
export function groupBreakdownByProduct(rows) {
  const byCard = new Map(); // cardKey → { key, label, total, _tt: Map }
  for (const b of rows || []) {
    const q = Number(b?.quantity) || 0;
    if (q <= 0) continue;
    const cardKey = b.cardGroupId || b.cardTitle || '—';
    let card = byCard.get(cardKey);
    if (!card) {
      card = { key: cardKey, label: b.cardTitle || 'כרטיס', total: 0, _tt: new Map() };
      byCard.set(cardKey, card);
    }
    card.total += q;
    const ttKey = b.ticketTypeId || b.ticketLabel || '—';
    const tt = card._tt.get(ttKey) || { key: ttKey, label: b.ticketLabel || 'כרטיס', quantity: 0 };
    tt.quantity += q;
    card._tt.set(ttKey, tt);
  }
  return [...byCard.values()].map((c) => ({
    key: c.key,
    label: c.label,
    total: c.total,
    ticketTypes: [...c._tt.values()],
  }));
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

// One registration → its canonical participant breakdown row. Carries stable
// matching keys (registrationId / bookingId / dealId) so consumers (admin modal,
// guide portal) can attach the SAME per-customer composition to their own cards.
function customerBreakdown(reg) {
  const rows = Array.isArray(reg.ticketBreakdown) ? reg.ticketBreakdown : [];
  const byProduct = groupBreakdownByProduct(rows);
  const total = byProduct.reduce((n, c) => n + c.total, 0) || Number(reg.quantity) || 0;
  return {
    registrationId: reg.id,
    bookingId: reg.bookingId || null,
    dealId: reg.dealId || null,
    label: registrationLabel(reg) || 'ללא שם',
    held: isHeld(reg.status),
    total,
    byProduct,
  };
}

// PURE. The canonical tour breakdown, reused by the admin modal AND the guide
// portal. → { aggregate: { total, byProduct }, customers: [customerBreakdown…] }.
// Generic — only the products/ticket types present in the data appear.
export function tourParticipantBreakdown(registrationRows) {
  const customers = (registrationRows || []).map(customerBreakdown);
  const allRows = (registrationRows || []).flatMap((r) => (Array.isArray(r.ticketBreakdown) ? r.ticketBreakdown : []));
  const total = customers.reduce((n, c) => n + (c.total || 0), 0);
  return { aggregate: { total, byProduct: groupBreakdownByProduct(allRows) }, customers };
}
