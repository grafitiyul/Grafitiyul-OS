// Canonical TicketRegistration lifecycle transitions — the ONE place a
// registration moves held → confirmed | expired. Extends the existing
// TicketRegistration (no second reservation entity). Every transition then
// refreshes the open tour's derived product + Woo stock (the shared post-step
// every registration source funnels through).

import { recomputeTourOperationalProduct } from './operationalProduct.js';
import { markTourWooPending } from './woo/service.js';
import { REG_HELD, REG_CONFIRMED, REG_EXPIRED } from './registrationStatus.js';

async function refresh(client, tourEventId) {
  // recompute self-gates on group_slot; the Woo mark is cheap + self-skipping.
  await recomputeTourOperationalProduct(client, tourEventId);
  await markTourWooPending(client, tourEventId);
}

// Create a HELD reservation — consumes capacity + participates in derivation,
// but is NOT a confirmed customer. expiresAt is the canonical hold deadline; the
// owning Deal stays OPEN until payment confirms it.
export async function createHeldRegistration(client, data) {
  const reg = await client.ticketRegistration.create({
    data: {
      tourEventId: data.tourEventId,
      productVariantId: data.productVariantId ?? null,
      priceRuleId: data.priceRuleId ?? null,
      cardGroupId: data.cardGroupId ?? null,
      quantity: Number(data.quantity) || 0,
      ...(data.ticketBreakdown !== undefined ? { ticketBreakdown: data.ticketBreakdown } : {}),
      source: data.source || 'deal',
      dealId: data.dealId ?? null,
      bookingId: data.bookingId ?? null,
      externalOrderId: data.externalOrderId ?? null,
      externalLineId: data.externalLineId ?? null,
      customerName: data.customerName ?? null,
      customerEmail: data.customerEmail ?? null,
      customerPhone: data.customerPhone ?? null,
      status: REG_HELD,
      paymentStatus: 'pending',
      expiresAt: data.expiresAt,
      heldAt: new Date(),
      notes: data.notes ?? null,
    },
  });
  await refresh(client, data.tourEventId);
  return reg;
}

// Confirm a registration (payment succeeded / register-without-payment). Held →
// confirmed: clears the expiry, links the booking when one exists. Identity is
// preserved — the SAME row, never a duplicate.
export async function confirmRegistration(client, registrationId, { bookingId, paymentStatus = 'paid', noPaymentReason } = {}) {
  const reg = await client.ticketRegistration.update({
    where: { id: registrationId },
    data: {
      status: REG_CONFIRMED,
      confirmedAt: new Date(),
      expiresAt: null,
      paymentStatus,
      ...(bookingId ? { bookingId } : {}),
      ...(noPaymentReason !== undefined ? { noPaymentReason } : {}),
    },
  });
  await refresh(client, reg.tourEventId);
  return reg;
}

// Expire a lapsed HELD reservation — releases capacity (no longer counted).
export async function expireRegistration(client, registrationId) {
  const reg = await client.ticketRegistration.update({
    where: { id: registrationId },
    data: { status: REG_EXPIRED, expiredAt: new Date() },
  });
  await refresh(client, reg.tourEventId);
  return reg;
}

// The deal's live HELD reservation (one per deal) — used to ADOPT it at WON
// instead of creating a duplicate confirmed registration.
export async function findHeldRegistrationForDeal(client, dealId) {
  return client.ticketRegistration.findFirst({
    where: { dealId, status: REG_HELD },
    orderBy: { createdAt: 'desc' },
  });
}
