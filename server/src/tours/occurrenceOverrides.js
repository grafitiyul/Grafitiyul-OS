// Occurrence-level overrides for Open Tours — the actions that touch an
// ALREADY-materialized slot (the generation cursor only shapes FUTURE dates, so
// an exception added after a slot exists must reconcile that slot directly), and
// the operator's manual product pin that suspends registration-driven
// derivation.

import { calendarPendingPatch, kickTourCalendarSync } from './calendar/service.js';
import { wooPendingPatch, kickWooSync, markTourWooPending } from './woo/service.js';
import { recomputeTourOperationalProduct } from './operationalProduct.js';
import { seedTourComponents } from './tourComponents.js';

// Decide what a cancel/time_override exception does to one existing slot. Pure —
// returns { action: 'cancel' | 'retime' | 'skip', reason?, data? }.
export function planExceptionForSlot(exception, slot, activeRegistrations) {
  if (exception.type === 'cancel') {
    // Never silently cancel a slot that already has registrations — surface it
    // for the operator instead of destroying allocations.
    if (activeRegistrations > 0) return { action: 'skip', reason: 'has_registrations' };
    return { action: 'cancel' };
  }
  if (exception.type === 'time_override') {
    if (!exception.time || exception.time === slot.startTime) return { action: 'skip', reason: 'noop' };
    return { action: 'retime', data: { startTime: exception.time } };
  }
  return { action: 'skip', reason: 'not_applicable' }; // 'add' is handled by generation
}

// Apply an exception to every already-materialized scheduled slot on its date.
// Returns { cancelled, retimed, skipped }.
export async function applyExceptionToSlots(client, templateId, exception) {
  const slots = await client.tourEvent.findMany({
    where: { openTourTemplateId: templateId, date: exception.date, status: 'scheduled', kind: 'group_slot' },
    select: { id: true, startTime: true },
  });
  const summary = { cancelled: 0, retimed: 0, skipped: 0 };
  let dirty = false;
  for (const slot of slots) {
    const activeRegs = await client.ticketRegistration.count({
      where: { tourEventId: slot.id, status: 'active' },
    });
    const plan = planExceptionForSlot(exception, slot, activeRegs);
    if (plan.action === 'cancel') {
      await client.tourEvent.update({
        where: { id: slot.id },
        data: { status: 'cancelled', cancelledAt: new Date(), ...calendarPendingPatch(), ...wooPendingPatch() },
      });
      summary.cancelled += 1;
      dirty = true;
    } else if (plan.action === 'retime') {
      await client.tourEvent.update({
        where: { id: slot.id },
        data: { ...plan.data, ...calendarPendingPatch(), ...wooPendingPatch() },
      });
      summary.retimed += 1;
      dirty = true;
    } else {
      summary.skipped += 1;
    }
  }
  if (dirty) {
    kickTourCalendarSync();
    kickWooSync();
  }
  return summary;
}

// Manually PIN a slot's operational product (operator override). Derivation
// stops touching it (productManualOverride) until the pin is released. Components
// are reseeded from the chosen variant's defaults.
export async function setManualProduct(client, tourEventId, productVariantId) {
  const variant = await client.productVariant.findUnique({
    where: { id: productVariantId },
    select: { id: true, productId: true },
  });
  if (!variant) {
    const e = new Error('invalid_product_variant');
    e.code = 'invalid_product_variant';
    throw e;
  }
  const tour = await client.tourEvent.findUnique({
    where: { id: tourEventId },
    select: { id: true, kind: true },
  });
  if (!tour || tour.kind !== 'group_slot') {
    const e = new Error('not_a_group_slot');
    e.code = 'not_a_group_slot';
    throw e;
  }
  await client.tourEvent.update({
    where: { id: tourEventId },
    data: {
      productVariantId: variant.id,
      productId: variant.productId,
      productManualOverride: true,
      ...calendarPendingPatch(),
      ...wooPendingPatch(),
    },
  });
  await client.tourEventActivityComponent.deleteMany({ where: { tourEventId } });
  await seedTourComponents(client, tourEventId, variant.id);
  kickTourCalendarSync();
  kickWooSync();
}

// Release the manual pin and re-derive the product from active registrations.
export async function clearManualProduct(client, tourEventId) {
  await client.tourEvent.update({
    where: { id: tourEventId },
    data: { productManualOverride: false },
  });
  const result = await recomputeTourOperationalProduct(client, tourEventId);
  await markTourWooPending(client, tourEventId);
  return result;
}
