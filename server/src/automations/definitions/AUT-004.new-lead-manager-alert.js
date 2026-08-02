// AUT-004 — ליד חדש: עדכון מנהלים בווטסאפ.
//
// When a GENUINELY NEW lead deal is born from an EXTERNAL intake origin, the
// managers get a WhatsApp heads-up: source, customer, phone, and a direct GOS
// deal link.
//
// ── What this file does and does NOT do ──────────────────────────────────────
// It DECIDES. It fires this automation's own Communication Center trigger and
// stops. Wording (Hebrew + English side by side), channel, the manager
// WhatsApp destination and the manager sending window are all configured in
// the Communication Center against the trigger "AUT-004 · ליד חדש", exactly
// like every other message. Nothing here composes text or sends anything.
//
// ── What counts as an external lead (the origin rule) ────────────────────────
// The trigger fires from the CANONICAL external-intake code paths only:
//   * the Ingress Platform pipeline (Meta Lead Ads, website forms, and every
//     adapter added in the future) — on outcome created_deal of kind 'lead';
//   * the Pipedrive lead bridge (mirror creators) — the create-only legacy
//     ingress that still carries website/Make leads, on a genuinely NEW open
//     deal.
// Never inferred from which screen created the deal. Manual creation, deals
// opened from WhatsApp/Email conversations, duplication, migration imports
// and backfills have no code path to this trigger.

import { registerAutomation } from '../registry.js';

const definition = {
  id: 'AUT-004',
  slug: 'new_lead_manager_alert',
  nameHe: 'ליד חדש — עדכון מנהלים בווטסאפ',
  descriptionHe:
    'כשנוצר ליד חדש אמיתי ממקור חיצוני (טופס אתר, מטא, אינטגרציה) — נשלחת הודעת ווטסאפ '
    + 'למנהלים דרך מרכז התקשורת, עם המקור, שם הלקוח, הטלפון וקישור ישיר לדיל ב-GOS. '
    + 'יצירה ידנית, פתיחת דיל מווטסאפ/מייל, שכפול וייבוא היסטורי לעולם אינם מפעילים אותה.',
  category: 'crm',
  defaultEnabled: true,

  trigger: {
    kind: 'external_lead_created',
    contexts: ['deal', 'contact', 'org'],
  },

  actions: [{ kind: 'communication' }],

  dependsOn: [
    // Soft: until a published message exists on the derived trigger, the
    // registry shows ממתינה לתלות (waiting) — configuration, not code.
    { kind: 'communication_trigger', triggerType: 'automation:AUT-004' },
  ],

  // ONE notification per created deal, forever. The deal id is the immutable
  // creation-event identity: a replayed webhook, an ingress retry or a worker
  // restart resolves to the same deal and is dropped here (P2002).
  idempotency: (ev) => `AUT-004:${ev.dealId}`,

  notesHe:
    'ההודעה נוצרת רק מנקודות הכניסה הקנוניות של לידים חיצוניים (פלטפורמת האינגרס + גשר '
    + 'הלידים מ-Pipedrive) — מקור חיצוני חדש שיתווסף לפלטפורמה ייכלל אוטומטית. יעד '
    + 'הווטסאפ ושעות השליחה נשלטים במרכז התקשורת (קהל מנהלים), לא בקוד.',
};

registerAutomation(definition);
export default definition;
