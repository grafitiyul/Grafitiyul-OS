// Client re-export of THE canonical email delivery state
// (shared/emailDelivery.mjs). Same convention as lib/duration.js.
//
// Every surface that shows whether an email went out — timeline rows, toasts,
// the send archive, the scheduled list, בקרה cards — renders from here. A
// screen that decides "sent" on its own is the bug this module exists to stop.

export {
  DELIVERY_STATES,
  DELIVERY_LABEL_HE,
  DELIVERY_LABEL_EN,
  DELIVERY_TONE,
  canonicalDeliveryState,
  deliveryFromScheduledEmail,
  deliveryForImmediateSend,
  deliverySummaryHe,
  queuedToastHe,
  isDelivered,
  isTerminal,
  isInFlight,
  needsAttention,
} from '../../../shared/emailDelivery.mjs';
