// Live preview of a source-data correction.
// Mirrors the server resolver (src/migration/review/contactIdentity.js), which is
// the authority: it re-validates on save against the ORIGINAL snapshot values and
// refuses anything stale, invented, or copied rather than moved.
const val = (s) => String(s ?? '').trim();
const has = (list, v) => (list || []).some((x) => val(x) === val(v));

export const isEmptyEdit = (e) =>
  !e || ((e.removePhones || []).length + (e.removeEmails || []).length + (e.addPhones || []).length + (e.addEmails || []).length) === 0;

export function applyIdentityEdit(source, edit) {
  const phones = (source?.phones || []).map(val);
  const emails = (source?.emails || []).map(val);
  if (!edit) return { phones, emails, changed: false };
  const rmP = (edit.removePhones || []).map(val);
  const rmE = (edit.removeEmails || []).map(val);
  const addP = (edit.addPhones || []).map((a) => val(a?.value ?? a));
  const addE = (edit.addEmails || []).map((a) => val(a?.value ?? a));
  const keptPhones = phones.filter((p) => !rmP.includes(p));
  const keptEmails = emails.filter((e) => !rmE.includes(e));
  return {
    phones: [...keptPhones, ...addP.filter((p) => !keptPhones.includes(p))],
    emails: [...keptEmails, ...addE.filter((e) => !keptEmails.includes(e))],
    changed: rmP.length > 0 || rmE.length > 0 || addP.length > 0 || addE.length > 0,
  };
}

// Is a value currently marked for removal on this record?
export const isRemoved = (edit, kind, v) =>
  has(kind === 'phone' ? edit?.removePhones : edit?.removeEmails, v);

// Toggle "this identifier is wrong" on one record. Removing a value also withdraws
// any move that depended on it, so the draft can never be internally inconsistent.
export function toggleRemove(edits, legacyId, kind, value) {
  const next = { ...edits };
  const cur = { ...(next[legacyId] || {}) };
  const key = kind === 'phone' ? 'removePhones' : 'removeEmails';
  const list = [...(cur[key] || [])];
  const at = list.findIndex((x) => val(x) === val(value));
  if (at >= 0) list.splice(at, 1); else list.push(val(value));
  cur[key] = list;
  next[legacyId] = cur;

  // If the value is no longer being given up, no one may receive it.
  if (at >= 0) {
    for (const [id, e] of Object.entries(next)) {
      const addKey = kind === 'phone' ? 'addPhones' : 'addEmails';
      if (!(e?.[addKey] || []).length) continue;
      next[id] = { ...e, [addKey]: e[addKey].filter((a) => !(val(a.value) === val(value) && a.fromLegacyId === legacyId)) };
    }
  }
  return next;
}

// Send a removed identifier to another record in the cluster (a MOVE). `toId` of
// null means "just remove it, it belongs to nobody here".
export function setMoveTarget(edits, fromLegacyId, kind, value, toId) {
  const addKey = kind === 'phone' ? 'addPhones' : 'addEmails';
  const next = {};
  // Clear any existing recipient of this exact value first — it can only land once.
  for (const [id, e] of Object.entries(edits)) {
    next[id] = { ...e, [addKey]: (e?.[addKey] || []).filter((a) => !(val(a.value) === val(value) && a.fromLegacyId === fromLegacyId)) };
  }
  if (toId != null) {
    const cur = { ...(next[toId] || {}) };
    cur[addKey] = [...(cur[addKey] || []), { value: val(value), fromLegacyId }];
    next[toId] = cur;
  }
  return next;
}

// Where is this removed value being sent, if anywhere?
export function moveTargetOf(edits, fromLegacyId, kind, value) {
  const addKey = kind === 'phone' ? 'addPhones' : 'addEmails';
  for (const [id, e] of Object.entries(edits || {})) {
    if ((e?.[addKey] || []).some((a) => val(a.value) === val(value) && a.fromLegacyId === fromLegacyId)) return Number(id);
  }
  return null;
}

export const anyEdits = (edits) => Object.values(edits || {}).some((e) => !isEmptyEdit(e));

// Does the cluster still hold together after the corrections? Mirrors the server.
export function clusterKeySurvives({ clusterKind, clusterKey, members, edits }) {
  const holders = (members || []).filter((m) => {
    const eff = applyIdentityEdit(m, edits?.[m.legacyId]);
    if (clusterKind === 'email') return eff.emails.some((e) => e.toLowerCase() === String(clusterKey).toLowerCase());
    return eff.phones.some((p) => p.replace(/\D/g, '').endsWith(String(clusterKey).replace(/\D/g, '').slice(-9)));
  });
  return { survives: holders.length >= 2, holders: holders.map((m) => m.legacyId) };
}
