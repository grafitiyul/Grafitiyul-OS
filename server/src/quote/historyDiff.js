// Quote history diff — what changed between two consecutive GENERATED versions
// of the same offer. PURE: compares two frozen renderModelSnapshots (the public
// model shape: { language, blocks: [{ key, type, hidden, data }] }) and returns
// deduped Hebrew labels for the admin history popup. Snapshots are immutable, so
// the diff is stable forever; it is computed at read time and never stored.

const BLOCK_LABELS = {
  hero: 'כותרת',
  program: 'התוכנית',
  product_marketing: 'תיאור המוצר',
  why_us: 'למה גרפיטיול',
  city_content: 'תוכן העיר',
  pricing: 'מחיר',
  faq: 'שאלות נפוצות',
  cancellation: 'מדיניות ביטול',
  participant_policy: 'מדיניות משתתפים',
  video: 'וידאו',
  image_slot_1: 'תמונות',
  image_slot_2: 'תמונות',
};

const stable = (v) => JSON.stringify(v ?? null);

// Visible blocks by key. A hidden block is treated as absent, so hiding/showing
// a section registers as a change to that section.
function visibleByKey(model) {
  const map = new Map();
  for (const b of model?.blocks || []) {
    if (!b || b.hidden) continue;
    map.set(b.key, b);
  }
  return map;
}

export function diffQuoteSnapshots(prev, next) {
  if (!prev || !next) return null; // no baseline → no diff (first version / legacy)
  const labels = [];
  const add = (label) => { if (label && !labels.includes(label)) labels.push(label); };

  if ((prev.language || 'he') !== (next.language || 'he')) add('שפה');

  const a = visibleByKey(prev);
  const b = visibleByKey(next);
  const keys = new Set([...a.keys(), ...b.keys()]);

  for (const key of keys) {
    const pb = a.get(key) || null;
    const nb = b.get(key) || null;
    const type = nb?.type || pb?.type;
    if (type === 'signature') continue; // structural, never content

    // "משתתפים" is called out separately from the rest of the technical details.
    if (type === 'tour_details') {
      const pd = pb?.data || {};
      const nd = nb?.data || {};
      const { participants: pp, ...pRest } = pd;
      const { participants: np, ...nRest } = nd;
      if (stable(pp) !== stable(np)) add('משתתפים');
      if (stable(pRest) !== stable(nRest)) add('פרטים טכניים');
      continue;
    }

    if (stable(pb?.data) !== stable(nb?.data)) add(BLOCK_LABELS[type] || nb?.data?.title || pb?.data?.title || key);
  }

  return labels;
}
