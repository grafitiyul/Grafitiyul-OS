// Action: invoke a Communication Center rule.
//
// This is the ONLY way an automation reaches a customer, a guide or a manager.
// It fires the automation's own derived trigger and stops. Everything after that
// — which messages exist, their text, channel, audience, language, sending
// window, versioning, delivery rows and retries — belongs to the Communication
// Center and is unchanged by the presence of an automation.
//
// Deliberately NOT here: composing text, choosing recipients, picking a channel,
// touching a bridge or Gmail. An automation that did any of those would be a
// second messaging path.

import { processTrigger } from '../../communication/engine.js';
import { automationTriggerType } from '../registry.js';

/**
 * `action` needs no configuration: the trigger type is derived from the
 * automation's own id, so a definition cannot point at the wrong rule.
 *
 * Returns the number of deliveries the Communication Center created. Zero is a
 * legitimate, reportable outcome (no rule configured yet, or every rule's
 * applicability conditions excluded this event) — not an error.
 */
export async function fireCommunicationAction(_action, { def, refs, log = console }) {
  const type = automationTriggerType(def.id);
  try {
    // Awaited, not fire-and-forget: the run row must record what actually
    // happened. The CALLER (the runtime) is what runs detached from the
    // submission, so this can never slow a questionnaire submit.
    const { created } = await processTrigger({
      type,
      dealId: refs.dealId || null,
      tourEventId: refs.tourEventId || null,
      // Business identity of the event — the Communication Center's own
      // idempotency is (messageId, triggerKey, recipientKey), so replaying the
      // same submission can never produce a second delivery.
      triggerRef: refs.submissionId,
      data: refs.triggerData || null,
    }, log);

    return {
      ok: true,
      ref: type,
      detailHe: created > 0
        ? `נוצרו ${created} משלוחים במרכז התקשורת`
        : 'לא הוגדר מסר פעיל על הטריגר — לא נוצר משלוח',
      created,
    };
  } catch (err) {
    return { ok: false, ref: type, error: String(err?.message || err).slice(0, 300) };
  }
}
