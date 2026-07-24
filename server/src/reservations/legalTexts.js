// Travel Agency Reservations — THE canonical legal/contractual wording registry.
//
// One source of truth for every legal sentence in the reservation contract:
//   • the flexible-cancellation statement the agent explicitly accepts (the
//     EXACT checkbox text, line for line);
//   • the request/approval disclaimer the summary document carries;
//   • the invoice-delivery wording the document prints.
//
// Contract (legal immutability):
//   1. The public form receives these texts via the bootstrap payload and
//      renders the acceptance checkbox from THEM — what the agent sees
//      immediately before signing is this registry, not a client-side copy.
//   2. At submit, the texts (in the session's language) are FROZEN verbatim
//      into session.legalConfirmations / payloadSnapshot.legal.
//   3. The summary PDF renders legal content ONLY from that frozen snapshot.
// Editing this file therefore changes future submissions only; it can never
// alter the meaning or wording of an already-issued document.
//
// Bump LEGAL_TEXTS_VERSION on any material wording change — the accepted
// version is recorded with each confirmation.

export const LEGAL_TEXTS_VERSION = 1;

export const LEGAL_TEXTS = {
  he: {
    cancellation: {
      // EXACT acceptance statement — first line is the lead-in, the rest are
      // the terms. Rendered as separate lines in the form and the PDF.
      lines: [
        'תנאי הביטול הגמישים במיוחד לסוכני תיירות ידועים לי:',
        'עד 24 שעות לפני הפעילות ללא דמי ביטול.',
        'בפחות מ־24 שעות - דמי ביטול של 100%.',
      ],
    },
    disclaimer:
      'מסמך זה מסכם את בקשת ההזמנה כפי שהוגשה. ההזמנה תיכנס לתוקף רק לאחר אישור סופי של גרפיטיול לכל קבוצה.',
    invoice: {
      title: 'משלוח חשבונית',
      toOrganizer: 'למזמין ההזמנה',
      toFinance: 'לאיש הכספים',
    },
  },
  en: {
    cancellation: {
      lines: [
        'I acknowledge the especially flexible cancellation terms for travel agents:',
        'Up to 24 hours before the activity — no cancellation fee.',
        'Less than 24 hours — a 100% cancellation fee.',
      ],
    },
    disclaimer:
      'This document summarizes the reservation request as submitted. The reservation becomes final only after confirmation by Grafitiyul for each group.',
    invoice: {
      title: 'Invoice delivery',
      toOrganizer: 'To the booker',
      toFinance: 'To the finance contact',
    },
  },
};

// The registry for one session language ('he' | 'en'), plus the version stamp.
// This exact object is what gets frozen into the payload snapshot.
export function legalTextsFor(language) {
  const lang = language === 'en' ? 'en' : 'he';
  return { version: LEGAL_TEXTS_VERSION, language: lang, ...LEGAL_TEXTS[lang] };
}
