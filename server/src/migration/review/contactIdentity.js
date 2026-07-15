// Source-data corrections for Contacts — "this phone/email is on the wrong person".
//
// NOT a merge decision. A cluster decision answers "are these the same person?";
// this answers "does this identifier actually belong to this person?". They are
// independent, and a record with no duplicate at all can still need a correction.
//
// ── ARCHITECTURE (owner-approved) ─────────────────────────────────────────────
//   * Snapshot #1 is IMMUTABLE. Nothing here ever writes to it.
//   * The original source values are never modified — they are re-read from the
//     snapshot on every load and stored alongside the correction as evidence.
//   * A correction is a MigrationDecision OVERRIDE, keyed by SOURCE CONTACT
//     (`contact_identity` / `person:<legacyId>`), never by cluster: one legacy
//     record may appear in a phone cluster AND an email cluster, and it must not be
//     possible to give it two conflicting corrections.
//   * Identity Import (Slice 6) APPLIES these overrides while importing.
//   * The Snapshot Browser always keeps showing the original values.
//
// A correction can only REMOVE an identifier, or MOVE one to another record in the
// same cluster. It can never invent a value that is not in the snapshot: this tool
// fixes what the legacy system got wrong, it does not author new identity data.

export const IDENTITY_QUEUE = 'contact_identity';
export const identitySubjectKey = (legacyId) => `person:${legacyId}`;
export const legacyIdFromSubjectKey = (key) => {
  const m = /^person:(\d+)$/.exec(String(key || ''));
  return m ? Number(m[1]) : null;
};

// Identifiers are matched EXACTLY as stored. A correction targets one concrete raw
// value on one concrete record, so normalising here would only create ambiguity
// (two records can hold the same number written two different ways).
const val = (s) => String(s ?? '').trim();
const has = (list, v) => (list || []).some((x) => val(x) === val(v));

export const EMPTY_EDIT = { removePhones: [], removeEmails: [], addPhones: [], addEmails: [] };

// The effective identity GOS will import for one source contact.
// `source` is the ORIGINAL snapshot record; it is never mutated.
export function applyIdentityEdit(source, edit) {
  const phones = (source?.phones || []).map(val);
  const emails = (source?.emails || []).map(val);
  if (!edit) return { phones, emails, changed: false, removed: { phones: [], emails: [] }, added: { phones: [], emails: [] } };

  const rmP = (edit.removePhones || []).map(val);
  const rmE = (edit.removeEmails || []).map(val);
  const addP = (edit.addPhones || []).map((a) => val(a?.value ?? a));
  const addE = (edit.addEmails || []).map((a) => val(a?.value ?? a));

  const keptPhones = phones.filter((p) => !rmP.includes(p));
  const keptEmails = emails.filter((e) => !rmE.includes(e));
  // A moved-in value is appended, never duplicated.
  const outPhones = [...keptPhones, ...addP.filter((p) => !keptPhones.includes(p))];
  const outEmails = [...keptEmails, ...addE.filter((e) => !keptEmails.includes(e))];

  return {
    phones: outPhones,
    emails: outEmails,
    changed: rmP.length > 0 || rmE.length > 0 || addP.length > 0 || addE.length > 0,
    removed: { phones: phones.filter((p) => rmP.includes(p)), emails: emails.filter((e) => rmE.includes(e)) },
    added: { phones: addP, emails: addE },
  };
}

const isEmptyEdit = (e) =>
  !e || ((e.removePhones || []).length + (e.removeEmails || []).length + (e.addPhones || []).length + (e.addEmails || []).length) === 0;

// Validate a whole cluster's worth of corrections at once, because a MOVE spans two
// records and only makes sense as one atomic submission.
//
// `members` are the ORIGINAL source records of the cluster (from the proposal).
// Returns { valid, problems, warnings }.
export function validateIdentityEdits(members, edits) {
  const problems = [];
  const warnings = [];
  const byId = new Map((members || []).map((m) => [m.legacyId, m]));

  for (const [rawId, edit] of Object.entries(edits || {})) {
    const legacyId = Number(rawId);
    const src = byId.get(legacyId);
    if (!src) { problems.push(`רשומת מקור ${legacyId} אינה חלק מהקבוצה הזו`); continue; }
    if (isEmptyEdit(edit)) continue;

    // You can only remove something the source record actually has. A stale edit
    // (the snapshot was re-read and no longer holds the value) must fail loudly
    // rather than silently do nothing.
    for (const p of edit.removePhones || []) {
      if (!has(src.phones, p)) problems.push(`הטלפון ${val(p)} אינו קיים ברשומה "${src.name}"`);
    }
    for (const e of edit.removeEmails || []) {
      if (!has(src.emails, e)) problems.push(`האימייל ${val(e)} אינו קיים ברשומה "${src.name}"`);
    }

    // An ADD is only ever the receiving half of a MOVE: the value must exist on the
    // named source record, and that record must give it up in this same submission.
    // Without this, "add" would let the owner invent identity data or copy one
    // number onto two people — the exact problem this tool exists to fix.
    for (const a of [...(edit.addPhones || []), ...(edit.addEmails || [])]) {
      const isPhone = (edit.addPhones || []).includes(a);
      const kind = isPhone ? 'phones' : 'emails';
      const label = isPhone ? 'הטלפון' : 'האימייל';
      const from = byId.get(a?.fromLegacyId);
      if (!from) { problems.push(`${label} ${val(a?.value)} חייב להגיע מרשומה אחרת בקבוצה`); continue; }
      if (from.legacyId === legacyId) { problems.push(`${label} ${val(a?.value)} כבר שייך לרשומה הזו`); continue; }
      if (!has(from[kind], a.value)) { problems.push(`${label} ${val(a?.value)} אינו קיים ברשומה "${from.name}"`); continue; }
      const giver = edits[from.legacyId];
      const givenUp = isPhone ? giver?.removePhones : giver?.removeEmails;
      if (!has(givenUp, a.value)) {
        problems.push(`${label} ${val(a?.value)} חייב להיות מוסר מ"${from.name}" — העברה, לא העתקה`);
      }
    }
  }

  // A record stripped of every identifier is legal (its name and history remain) but
  // the owner should see it.
  for (const m of members || []) {
    const eff = applyIdentityEdit(m, edits?.[m.legacyId]);
    if (!eff.changed) continue;
    if (!eff.phones.length && !eff.emails.length && ((m.phones || []).length || (m.emails || []).length)) {
      warnings.push(`לרשומה "${m.name}" לא יישאר אף טלפון או אימייל`);
    }
  }

  return { valid: problems.length === 0, problems, warnings };
}

// What the owner is about to change, per record — the live preview and the stored
// audit both read this, so they cannot drift.
export function resolveIdentityEdits(members, edits) {
  const records = (members || []).map((m) => {
    const eff = applyIdentityEdit(m, edits?.[m.legacyId]);
    return {
      legacyId: m.legacyId,
      name: m.name,
      original: { phones: (m.phones || []).map(val), emails: (m.emails || []).map(val) },
      effective: { phones: eff.phones, emails: eff.emails },
      removed: eff.removed,
      added: eff.added,
      changed: eff.changed,
    };
  });
  const { valid, problems, warnings } = validateIdentityEdits(members, edits);
  return { records, changedCount: records.filter((r) => r.changed).length, valid, problems, warnings };
}

// Does the cluster still hold together after the corrections? The engine matched on
// the ORIGINAL data, so a correction can remove the very reason these records met —
// which is exactly what the owner is usually telling us. Say so plainly instead of
// letting them approve a merge whose evidence no longer exists.
export function clusterKeySurvives({ clusterKind, clusterKey, members, edits }) {
  const field = clusterKind === 'phone' ? 'phones' : 'emails';
  const holders = (members || []).filter((m) => {
    const eff = applyIdentityEdit(m, edits?.[m.legacyId]);
    // The phone key is a NORMALISED candidate, so compare on the raw values the
    // record still holds via the same match the engine used (matchedOn), plus an
    // exact check for email keys.
    if (clusterKind === 'email') return eff.emails.some((e) => e.toLowerCase() === String(clusterKey).toLowerCase());
    return eff.phones.length > 0 && eff.phones.some((p) => p.replace(/\D/g, '').endsWith(String(clusterKey).replace(/\D/g, '').slice(-9)));
  });
  return { survives: holders.length >= 2, holders: holders.map((m) => m.legacyId) };
}

// The stored override for ONE source contact. `original` is kept as evidence of what
// the snapshot said when the correction was made — never as a substitute for it.
export function identityDecisionFor(source, edit) {
  const eff = applyIdentityEdit(source, edit);
  return {
    legacyId: source.legacyId,
    removePhones: (edit?.removePhones || []).map(val),
    removeEmails: (edit?.removeEmails || []).map(val),
    addPhones: (edit?.addPhones || []).map((a) => ({ value: val(a.value), fromLegacyId: a.fromLegacyId ?? null })),
    addEmails: (edit?.addEmails || []).map((a) => ({ value: val(a.value), fromLegacyId: a.fromLegacyId ?? null })),
    // What Identity Import must end up with. Stored explicitly so the importer never
    // has to re-derive intent from a diff.
    effective: { phones: eff.phones, emails: eff.emails },
  };
}

export const identityProposalFor = (source) => ({
  kind: 'contact_identity',
  legacyId: source.legacyId,
  name: source.name,
  original: { phones: (source.phones || []).map(val), emails: (source.emails || []).map(val) },
  source: { entity: 'pipedrive/persons', id: source.legacyId },
});

export { isEmptyEdit };
