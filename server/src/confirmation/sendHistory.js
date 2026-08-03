// Confirmation Email — first-send vs repeat-send semantics.
//
// DEFINITION (audited, deliberate):
//   A "real send" is a ConfirmationEmailSend row that is NOT a test send
//   (generationMeta.test !== true) AND whose queue row did not die
//   (ScheduledEmail.status not in failed/cancelled). A snapshot is written
//   when the email is HANDED TO THE QUEUE, and the queue owns retries — so a
//   pending/sending/sent row counts as "the customer is getting this one",
//   while a permanently failed or cancelled one never reached them and must
//   not make the NEXT email look like an update.
//
// The repeat suffix is applied at SEND time only. It is never stored in the
// template subject, and stripping-before-appending makes it idempotent, so a
// worker retry or a double-click can never produce " - הכי עדכני - הכי עדכני".

export const REPEAT_SUFFIX = { he: ' - הכי עדכני', en: ' - most updated' };
export const TEST_MARKER = ' [בדיקה]';

const DEAD_QUEUE_STATUSES = new Set(['failed', 'cancelled']);

/** Idempotent: append the repeat marker unless it is already the tail. */
export function applyRepeatSuffix(subject, lang) {
  const base = stripRepeatSuffix(subject);
  if (!base) return base;
  return `${base}${lang === 'en' ? REPEAT_SUFFIX.en : REPEAT_SUFFIX.he}`;
}

/** Remove a repeat marker in EITHER language (idempotency + test subjects). */
export function stripRepeatSuffix(subject) {
  let s = String(subject || '').trimEnd();
  for (;;) {
    const before = s;
    for (const suffix of [REPEAT_SUFFIX.he, REPEAT_SUFFIX.en]) {
      if (s.endsWith(suffix)) s = s.slice(0, -suffix.length).trimEnd();
    }
    if (s === before) return s;
  }
}

/** Test marker always trails the REAL subject, and never doubles. */
export function applyTestMarker(subject) {
  const base = String(subject || '').trimEnd();
  if (!base) return base;
  return base.endsWith(TEST_MARKER.trim()) ? base : `${base}${TEST_MARKER}`;
}

/**
 * The final customer subject for one send.
 *  • test  → "<subject> [בדיקה]", and NEVER the repeat marker: a test must
 *    not claim to be an update just because real sends exist.
 *  • real  → base subject on the first real send, + the repeat marker on
 *    every later one.
 */
export function buildSendSubject({ subject, lang, isTest, priorRealSends }) {
  const base = stripRepeatSuffix(subject); // template subjects never carry it
  if (isTest) return applyTestMarker(base);
  return priorRealSends > 0 ? applyRepeatSuffix(base, lang) : base;
}

/**
 * How many REAL confirmation emails this deal already handed to the queue.
 * Tests excluded; dead queue rows excluded (see the definition above).
 */
export async function countRealSends(db, dealId) {
  const sends = await db.confirmationEmailSend.findMany({
    where: { dealId },
    select: { id: true, scheduledEmailId: true, generationMeta: true },
  });
  const real = sends.filter((s) => !s.generationMeta?.test);
  if (!real.length) return 0;
  const queueIds = real.map((s) => s.scheduledEmailId).filter(Boolean);
  if (!queueIds.length) return real.length;
  const rows = await db.scheduledEmail.findMany({
    where: { id: { in: queueIds } },
    select: { id: true, status: true },
  });
  const dead = new Set(rows.filter((r) => DEAD_QUEUE_STATUSES.has(r.status)).map((r) => r.id));
  return real.filter((s) => !s.scheduledEmailId || !dead.has(s.scheduledEmailId)).length;
}
