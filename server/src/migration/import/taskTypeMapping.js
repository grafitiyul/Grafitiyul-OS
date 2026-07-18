// Historical task-type mapping (owner-approved 2026-07-21). Pure + deterministic.
//
// Only IMPORTED Pipedrive tasks (LegacyRecord entityType 'Task') are affected,
// and only where taskTypeId is currently null. Native GOS tasks are never
// touched. Setting a type is a LABEL change only — it never alters channel or
// creates a WhatsAppScheduledMessage, so a task can never become a live send.
//
// The mapping keys are the Pipedrive activity-type LABELS (Hebrew) as approved;
// the raw whatsapp key is matched too. Any activity type NOT in the table does
// NOT remain a live task — it is demoted to historical timeline evidence.

const norm = (s) => String(s ?? '').trim();

// source activity-type label (or raw key) → GOS TaskType.key
export const TASK_TYPE_MAP = Object.freeze({
  'ליד חדש לשיוך': 'first_call',
  'לידים רותחים': 'first_call',
  'שיחה ראשונית': 'first_call',
  'שיחה ראשונית שלא נענתה': 'missed_call',
  'גבייה': 'collection',
  'פולואפ': 'follow_up',
  'מעקב לתגובת לקוח להצעת מחיר': 'follow_up',
  'whatsapp': 'whatsapp',
  'ווטסאפ': 'whatsapp',
});

/** Resolve one activity type (label or raw key) to a GOS TaskType key, or null. */
export function mapActivityType(typeLabel, rawKey) {
  const byLabel = TASK_TYPE_MAP[norm(typeLabel)];
  if (byLabel) return byLabel;
  const byKey = TASK_TYPE_MAP[norm(rawKey)];
  return byKey || null;
}

/**
 * Plan the task-type backfill.
 * @param items array of { taskId, taskTypeId (current), typeLabel, rawKey }
 * @param taskTypeIdByKey Map<GOS TaskType.key, id>
 * @returns { setType:[{taskId,typeKey,typeId}], demote:[{taskId,typeLabel}], skip:{alreadyTyped,unknownTarget}, stats }
 */
export function planTaskTypeBackfill(items, taskTypeIdByKey) {
  const setType = [];
  const demote = [];
  const skip = { alreadyTyped: 0, unknownTarget: 0 };
  const byTarget = {};
  const byUnmapped = {};
  for (const it of items) {
    if (it.taskTypeId != null) { skip.alreadyTyped += 1; continue; }
    const key = mapActivityType(it.typeLabel, it.rawKey);
    if (!key) {
      demote.push({ taskId: it.taskId, typeLabel: norm(it.typeLabel) });
      byUnmapped[norm(it.typeLabel)] = (byUnmapped[norm(it.typeLabel)] || 0) + 1;
      continue;
    }
    const typeId = taskTypeIdByKey.get(key);
    if (!typeId) { skip.unknownTarget += 1; continue; } // target type missing in catalog — never guess
    setType.push({ taskId: it.taskId, typeKey: key, typeId });
    byTarget[key] = (byTarget[key] || 0) + 1;
  }
  return { setType, demote, skip, stats: { total: items.length, setType: setType.length, demote: demote.length, byTarget, byUnmapped } };
}
