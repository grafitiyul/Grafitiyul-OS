import { isAirtableRecordId, isEmailLike } from '../../../shared/staffAssignmentDisplay.mjs';

// Generic historical-identity resolution. Old imported tours stored a guide's
// EMAIL in `externalPersonId` (before any GOS PersonRef existed) and left
// `personRefId` null. The moment a PersonRef with that email exists in GOS —
// created manually, promoted from recruitment, or edited to add the email — the
// historical rows must claim their canonical link. This ONE service does that,
// and every identity mutation that establishes/changes an email calls it, so no
// future flow can forget the behavior.
//
// Invariants (never violated):
//   * only rows with personRefId === null are ever touched (never re-point a row
//     already linked to a different person)
//   * matching is exact, normalized email equality only — never name, never
//     partial email
//   * an email that maps to MORE THAN ONE PersonRef is ambiguous → skip + report
//   * idempotent: re-running links nothing new and repairs nothing new
//   * no row is created or deleted, ever

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Link every unlinked historical TourAssignment + PayrollEntry whose email-shaped
// externalPersonId equals this PersonRef's canonical email.
//   opts.apply=false → dry-run (returns eligible counts, mutates nothing)
// Returns:
//   { personRefId, email, conflict, linkedAssignments, linkedPayroll, skippedReason }
export async function resolveHistoricalStaffLinks(client, personRefId, { apply = true } = {}) {
  const base = {
    personRefId,
    email: null,
    conflict: false,
    linkedAssignments: 0,
    linkedPayroll: 0,
    skippedReason: null,
  };

  const person = await client.personRef.findUnique({
    where: { id: personRefId },
    select: { id: true, email: true, displayName: true },
  });
  if (!person) return { ...base, skippedReason: 'person_not_found' };

  const email = normalizeEmail(person.email);
  if (!email) return { ...base, skippedReason: 'no_email' };
  // A non-email value can never match the historical email convention (and must
  // never be broadened to a name/handle match).
  if (!isEmailLike(email)) return { ...base, email, skippedReason: 'email_not_matchable' };

  // Ambiguity guard: if this normalized email belongs to more than one PersonRef
  // we cannot know which one owns the history. Skip and report the conflict.
  const sharing = await client.personRef.count({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (sharing > 1) return { ...base, email, conflict: true, skippedReason: 'ambiguous_email' };

  const match = { personRefId: null, externalPersonId: { equals: email, mode: 'insensitive' } };
  const eligibleAssignments = await client.tourAssignment.count({ where: match });
  const eligiblePayroll = await client.payrollEntry.count({ where: match });

  if (!apply) {
    return { ...base, email, linkedAssignments: eligibleAssignments, linkedPayroll: eligiblePayroll };
  }

  const a = await client.tourAssignment.updateMany({ where: match, data: { personRefId } });
  const p = await client.payrollEntry.updateMany({ where: match, data: { personRefId } });
  return { ...base, email, linkedAssignments: a.count, linkedPayroll: p.count };
}

// Best-effort wrapper for route handlers: link is a side benefit of an identity
// mutation, never a reason to fail the mutation's own response. Logs and swallows.
export async function tryResolveHistoricalStaffLinks(client, personRefId, opts) {
  try {
    return await resolveHistoricalStaffLinks(client, personRefId, opts);
  } catch (err) {
    console.warn(`[historicalStaffLinks] resolve failed for ${personRefId}`, err);
    return null;
  }
}

// ── Snapshot repair (backfill Phase B) ───────────────────────────────────────
// Classify every row whose displayName is a corrupted Airtable record id into a
// safe repair target. PURE over already-fetched rows so it is fully testable.
//   linked → canonical personRef.displayName
//   unlinked + email externalPersonId → that email
//   else → left unresolved (UI shows the neutral fallback; nothing invented)
export function planSnapshotRepairs(rows) {
  const toName = []; // { id, value }
  const toEmail = []; // { id, value }
  const unresolved = []; // { id }
  for (const r of rows || []) {
    if (!isAirtableRecordId(r.displayName)) continue; // strict — only true rec ids
    const canonical = r.personRef?.displayName;
    if (canonical && String(canonical).trim()) {
      toName.push({ id: r.id, value: String(canonical).trim() });
    } else if (isEmailLike(r.externalPersonId)) {
      toEmail.push({ id: r.id, value: String(r.externalPersonId).trim() });
    } else {
      unresolved.push({ id: r.id });
    }
  }
  return { toName, toEmail, unresolved };
}

// Group id→value pairs by value so a whole class of rows repairs in one
// updateMany (≈ one call per distinct name/email, not one per row).
export function groupByValue(pairs) {
  const byValue = new Map();
  for (const { id, value } of pairs) {
    if (!byValue.has(value)) byValue.set(value, []);
    byValue.get(value).push(id);
  }
  return byValue;
}
