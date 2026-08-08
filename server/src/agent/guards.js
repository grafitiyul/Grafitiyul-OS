// HARD GUARDS — the business protections that live in CODE, not in the prompt.
//
// A prompt is a request. A guard is a guarantee. Every constraint that actually
// matters appears in both (agent/prompts/build.js asks; this file enforces), and
// this file is the one that holds when the model has a bad day, when a prompt
// edit weakens an instruction, or when a customer message tries to talk the
// agent out of its rules.
//
// A guard hit NEVER rewrites the draft and never silently passes. It records a
// finding and forces the run to escalate with a stated reason — the operator
// sees the draft, the flag, and why.
//
// Findings are the audit trail of "what nearly went wrong", so they are also
// the highest-signal input to the Learning inbox.

import { knownAmountTexts } from './context/pack.js';

export const GUARD_TEXT = Object.freeze({
  deal_title_leak: 'הטיוטה הכילה את השם הפנימי של הדיל — שדה פנימי שאסור שיגיע ללקוח',
  invented_amount: 'הטיוטה מכילה סכום שלא מופיע בנתונים הקנוניים — ייתכן שהומצא',
  payment_claim: 'הטיוטה טוענת משהו על תשלום שלא מגובה במצב הגבייה הקנוני',
  booking_claim: 'הטיוטה מאשרת הזמנה/תאריך בלי סיור מאושר במערכת',
  raw_token: 'הטיוטה מכילה תבנית לא ממולאת ({{...}} / [...])',
  foreign_contact: 'הטיוטה מכילה טלפון או אימייל שלא שייך לשיחה הזו',
  disallowed_link: 'הטיוטה מכילה קישור שלא מופיע בידע המאושר',
  refund_language: 'הטיוטה עוסקת בהחזר כספי — נושא שמוגדר כאנושי בלבד',
  too_long: 'הטיוטה ארוכה בצורה חריגה להודעת ווטסאפ',
  empty: 'הטיוטה ריקה',
});

const MAX_REPLY_CHARS = 1500;

// Hosts a draft may link to. Anything else is refused: a link is an action, and
// the agent does not improvise actions. PUBLIC_ORIGIN covers our own capability
// URLs, which an operator mints deliberately — never the agent.
function allowedHosts() {
  const hosts = new Set(['grafitiyul.co.il', 'www.grafitiyul.co.il', 'waze.com', 'ul.waze.com', 'maps.google.com', 'goo.gl', 'maps.app.goo.gl']);
  try {
    const origin = process.env.PUBLIC_ORIGIN;
    if (origin) hosts.add(new URL(origin).host);
  } catch { /* unset or malformed — the static list still applies */ }
  return hosts;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
// Israeli + international phone shapes, and any email.
const PHONE_RE = /(?:\+?972[-\s]?|0)(?:[23489]|5\d|7\d)[-\s]?\d{3}[-\s]?\d{4}/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Currency amounts the draft asserts.
const AMOUNT_RE = /(?:₪|\$|€)\s?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:₪|ש"ח|שח|שקל|שקלים|ILS|NIS)/gi;

const PAYMENT_CLAIM_RE = /(התשלום התקבל|קיבלנו את התשלום|שולם במלואו|התשלום נקלט|הכסף התקבל|payment (?:was )?received|fully paid)/i;
const BOOKING_CLAIM_RE = /(ההזמנה אושרה|התאריך שמור|שמרנו לך|מאושר לתאריך|הזמנתך אושרה|your booking is confirmed|the date is reserved)/i;
const REFUND_RE = /(החזר כספי|נחזיר לך|זיכוי כספי|refund|money back)/i;

const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * Run every guard over a draft.
 *
 * @param {object} p
 *   text        the model's draft
 *   pack        the Context Pack the draft was generated from
 *   dealTitle   the deal's INTERNAL title, passed in solely so we can detect it
 *               leaking. It is never handed to the model — see context/pack.js.
 *   capabilityKey the classified situation
 * @returns {{ findings: Array<{code,detail}>, blocked: boolean }}
 *   `blocked` = the draft must not be offered as sendable; the run escalates.
 */
export function runGuards({ text, pack, dealTitle = null, capabilityKey = null }) {
  const findings = [];
  const add = (code, detail = null) => findings.push({ code, detail: detail || null });
  const draft = String(text || '');

  if (!draft.trim()) {
    add('empty');
    return { findings, blocked: true };
  }
  if (draft.length > MAX_REPLY_CHARS) add('too_long', `${draft.length} chars`);

  // 1. Deal.title is INTERNAL-ONLY (project rule 17). Compared on a normalized
  //    form so spacing or punctuation drift cannot smuggle it through.
  if (dealTitle && dealTitle.trim().length >= 6) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm(draft).includes(norm(dealTitle))) add('deal_title_leak');
  }

  // 2. No invented money. Every amount in the draft must be one we actually
  //    know. Compared on digits so "₪1,200" and "1200 ש\"ח" are the same fact.
  const known = new Set(knownAmountTexts(pack).map(digits).filter(Boolean));
  for (const m of draft.match(AMOUNT_RE) || []) {
    const d = digits(m);
    if (d && !known.has(d)) add('invented_amount', m.trim());
  }

  // 3. Payment claims must be backed by the canonical collection state. A deal
  //    under review is the strictest case: nobody may state what was paid.
  if (PAYMENT_CLAIM_RE.test(draft)) {
    const state = pack?.payment?.state;
    if (state !== 'paid' || pack?.payment?.needsReview) add('payment_claim', `collection state: ${state || 'unknown'}`);
  }

  // 4. Booking/date confirmation requires a real, live tour.
  if (BOOKING_CLAIM_RE.test(draft) && !pack?.tour?.date) add('booking_claim');

  // 5. Refunds are human-only in every mode.
  if (REFUND_RE.test(draft) || capabilityKey === 'refund_request') add('refund_language');

  // 6. Unfilled templates must never reach a customer.
  if (/\{\{[^}]*\}\}|\[(?:הכנס|insert|name|שם)[^\]]*\]/i.test(draft)) add('raw_token');

  // 7. No contact details that did not come from this conversation's context.
  //    The agent has no legitimate reason to type a phone number or an email:
  //    everything it may share about contacting us belongs in approved
  //    knowledge, and anything else is either invented or another customer's.
  const contextText = JSON.stringify(pack || {});
  for (const p of draft.match(PHONE_RE) || []) {
    if (!digits(contextText).includes(digits(p))) add('foreign_contact', p.trim());
  }
  for (const e of draft.match(EMAIL_RE) || []) {
    if (!contextText.includes(e)) add('foreign_contact', e.trim());
  }

  // 8. Links are allowlisted by host.
  const hosts = allowedHosts();
  for (const u of draft.match(URL_RE) || []) {
    let host = null;
    try { host = new URL(u).host.toLowerCase(); } catch { host = null; }
    if (!host || !hosts.has(host)) add('disallowed_link', u.slice(0, 120));
  }

  // Everything except a cosmetic length overrun blocks the draft from being
  // offered as sendable.
  const blocked = findings.some((f) => f.code !== 'too_long');
  return { findings, blocked };
}

/** One operator-readable sentence for the escalation reason. */
export function guardSummary(findings) {
  if (!findings?.length) return null;
  const codes = [...new Set(findings.map((f) => f.code))];
  return codes.map((c) => GUARD_TEXT[c] || c).join(' · ');
}
