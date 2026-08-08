// Which language should GOS speak to a lead that arrived from the website?
//
// The default is Hebrew, and until 2026-08-08 it was the ONLY answer: every
// ingress deal got `communicationLanguage: null`, which every downstream
// surface reads as Hebrew. Deal #27151 showed what that costs. A French tourist
// bought a Tel Aviv tour, GOS filed her under an empty Hebrew first name, and
// the confirmation email refused to send because {{שם פרטי}} resolved to
// nothing — so the one customer who most needed a confirmation got none.
//
// ── The rule ─────────────────────────────────────────────────────────────────
// English is chosen only on POSITIVE evidence, never on the absence of Hebrew:
//
//   1. the source stated a language          → trust it, always
//   2. the name is written in Latin script   → necessary, never sufficient
//      AND at least one independent signal agrees:
//        • a billing country that is not Israel, or
//        • a phone that resolved to a non-Israeli country code, or
//        • a phone that is a well-formed local number which is NOT in the
//          Israeli numbering plan (the #27151 case: 06 69 12 97 85)
//
// A Latin-spelled name alone is NOT enough: plenty of Israelis type "Yossi
// Cohen" into a checkout, and switching them to English would be a worse error
// than the one this fixes — it is visible to the customer on every message.
// Two independent signals is the conservative bar the owner asked for.
//
// The third phone signal is the weakest of the three and is included
// deliberately, because it is the ONLY one that catches #27151: that checkout
// left `billing.country` empty, so the numbering plan was the single piece of
// real evidence available. It can misfire on a Latin-named Israeli who typed a
// malformed phone number — a mild, visible, correctable error, against a
// customer who today receives no confirmation at all.
//
// Everything else returns null, which means "the system did not decide" and
// leaves the existing Hebrew default exactly as it was.

import { classifyNameScript } from '../../../shared/nameLanguage.mjs';
import { normalizePhoneIntl } from '../whatsapp/phone.js';

/**
 * @param normalized  a normalized ingress event (post normalize.js)
 * @returns 'en' | 'he' | null   — null = no decision, keep the default
 */
export function resolveIngressLanguage(normalized) {
  const stated = String(normalized?.person?.language || '').trim().toLowerCase();
  if (stated.startsWith('he') || stated === 'iw') return 'he';
  if (stated.startsWith('en')) return 'en';
  // A stated language GOS does not speak is still not a reason to guess; the
  // fall-through below applies.

  const person = normalized?.person || {};
  const script = classifyNameScript(`${person.firstName || ''} ${person.lastName || ''}`);
  if (script !== 'en') return null; // Hebrew, mixed or neutral → default

  const country = String(person.country || '').trim().toUpperCase();
  const foreignCountry = Boolean(country) && country !== 'IL';

  // A number that RESOLVED to a non-972 country code is decisive.
  const resolvedForeign = Boolean(person.phoneIntl) && !String(person.phoneIntl).startsWith('972');

  // A number that did not resolve at all, WITH no country hint to blame: it has
  // enough digits to be a real phone but is not in the Israeli numbering plan.
  const raw = String(person.phoneRaw || '').replace(/\D/g, '');
  const unplaceableNonIsraeli = !person.phoneIntl && raw.length >= 9 && !country;

  return foreignCountry || resolvedForeign || unplaceableNonIsraeli ? 'en' : null;
}
