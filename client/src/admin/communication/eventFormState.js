// Event-editor form state — the ONE reconciliation rule that fixes the
// "תיאור קצר disappeared" data-loss class.
//
// The editor holds TWO states: the server snapshot (messages, status,
// validation — always refreshable) and the user's editable form. A server
// refresh may arrive at any time (initial fetch resolving after typing began,
// or a child action reloading the event); it must NEVER overwrite fields the
// user changed. Rule: rehydrate the form from the fresh server data only when
// the form is CLEAN relative to the snapshot it was hydrated from; a dirty
// form is kept verbatim until the user explicitly saves (which force-
// rehydrates) or leaves.

import { valuesEqual } from '../../lib/dirtyForms.js';

export function toEventForm(event) {
  if (!event) return null;
  return {
    internalName: event.internalName ?? '',
    description: event.description ?? '',
    triggerType: event.triggerType,
    anchorType: event.anchorType,
    timingMode: event.timingMode,
    timingAmount: event.timingAmount ?? null,
    timingUnit: event.timingUnit ?? null,
    activityMode: event.activityMode,
    activityTypes: event.activityTypes ?? [],
    orgTypeIds: event.orgTypeIds ?? [],
    orgSubtypeIds: event.orgSubtypeIds ?? [],
    conditions: event.conditions ?? [],
  };
}

export function isEventFormDirty(form, serverEvent) {
  if (!form || !serverEvent) return false;
  return !valuesEqual(form, toEventForm(serverEvent));
}

/**
 * The next form after a server refresh: fresh hydration when clean, the
 * user's form untouched when dirty. `force` (after an explicit save) always
 * rehydrates.
 */
export function reconcileEventForm(prevForm, prevServerEvent, nextServerEvent, { force = false } = {}) {
  if (force || !prevForm || !prevServerEvent) return toEventForm(nextServerEvent);
  return isEventFormDirty(prevForm, prevServerEvent) ? prevForm : toEventForm(nextServerEvent);
}
