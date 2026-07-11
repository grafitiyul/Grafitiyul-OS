// Display-ready diff between the previous answer map and a newly submitted
// one — the payload of ONE immutable history entry (TimelineEntry kind=
// 'change', the same mechanism + renderer the Deal/Person changelogs use:
// data.changes = [{ fieldKey, labelHe, oldValue, newValue, oldDisplay,
// newDisplay }]). Autosave NEVER calls this — history is created only by the
// meaningful submit/update button presses.
//
// Pure module — takes the already-loaded question structure.

import { resolveLocalized } from '../../../shared/questionnaire/localized.mjs';

function displayValue(q, value, lang, defLang) {
  if (value === null || value === undefined || value === '') return null;
  const opts = q?.options || [];
  const labelOf = (v) => {
    const o = opts.find((x) => x.value === v);
    if (o) return resolveLocalized(o.label, lang, defLang) || String(v);
    if (typeof v === 'string' && v.startsWith('__other__:')) return v.slice('__other__:'.length);
    return String(v);
  };
  if (Array.isArray(value)) return value.map(labelOf).join(' · ');
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  if (typeof value === 'object') return value.name || 'קובץ מצורף';
  if (opts.length) return labelOf(value);
  return String(value);
}

const norm = (v) => JSON.stringify(v ?? null);

// prev/next: { [questionKey]: value } maps. questions: flat question rows of
// the version being submitted against (with options).
export function buildAnswerChanges({ prev, next, questions, lang, defLang }) {
  const changes = [];
  for (const q of questions) {
    if (q.type === 'static_text') continue;
    const before = prev[q.key];
    const after = next[q.key];
    if (norm(before) === norm(after)) continue;
    changes.push({
      fieldKey: q.key,
      labelHe: resolveLocalized(q.label, lang, defLang) || q.key,
      oldValue: before ?? null,
      newValue: after ?? null,
      oldDisplay: displayValue(q, before, lang, defLang),
      newDisplay: displayValue(q, after, lang, defLang),
    });
  }
  return changes;
}
