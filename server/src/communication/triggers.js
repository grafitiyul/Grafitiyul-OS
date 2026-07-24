// Communication trigger registry — the ONE list of business triggers the
// Communication Center reacts to. Adding a trigger is: (1) an entry here,
// (2) one `fireCommunicationTrigger(...)` call at the business site, AFTER the
// owning transaction commits. Never a new worker, never a bespoke engine.
//
// `contexts` names the business entities the trigger provides — the variable
// registry uses it to validate which variables/documents a message may use,
// and the condition evaluator to know which fields exist.

export const TRIGGERS = [
  {
    type: 'deal_won',
    labelHe: 'דיל נסגר (WON)',
    // 'reservation' included: a WON deal born from an agent reservation carries
    // its session (context.js derives it via reservationGroup), so the
    // canonical reservation PDF is attachable; deals without one resolve the
    // document as missing and the delivery policy handles it.
    contexts: ['deal', 'contact', 'org', 'tour', 'payment', 'quote', 'reservation'],
    anchors: ['trigger_time', 'tour_datetime'],
  },
  {
    type: 'deal_lost',
    labelHe: 'דיל אבוד (LOST)',
    contexts: ['deal', 'contact', 'org'],
    anchors: ['trigger_time'],
  },
  {
    type: 'reservation_submitted',
    labelHe: 'הזמנת סוכן נקלטה',
    contexts: ['deal', 'contact', 'org', 'reservation', 'payment'],
    anchors: ['trigger_time'],
  },
  {
    type: 'payment_received',
    labelHe: 'התקבל תשלום',
    contexts: ['deal', 'contact', 'org', 'tour', 'payment'],
    anchors: ['trigger_time'],
  },
  {
    type: 'tour_cancelled',
    labelHe: 'סיור בוטל',
    contexts: ['deal', 'contact', 'org', 'tour'],
    anchors: ['trigger_time'],
  },
];

export const TRIGGER_TYPES = TRIGGERS.map((t) => t.type);

export function triggerByType(type) {
  return TRIGGERS.find((t) => t.type === type) || null;
}

export const TIMING_UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'];
export const TIMING_MODES = ['immediate', 'before', 'after'];
export const ANCHOR_TYPES = ['trigger_time', 'tour_datetime'];
export const EVENT_STATUSES = ['draft', 'active', 'disabled', 'archived'];
export const MESSAGE_STATUSES = ['draft', 'active', 'disabled'];
export const CHANNELS = ['whatsapp', 'email'];
export const AUDIENCE_TYPES = [
  'primary_contact',
  'field_contact',
  'assigned_guides',
  'explicit_contact',
  'explicit_staff',
  'wa_group',
];
