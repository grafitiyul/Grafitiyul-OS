// Pure parsing/validation for POST /api/tasks/bulk.
//
// A bulk action is either a TRANSITION (complete / cancel — never delete;
// task history is auditable forever) or a FIELD EDIT expressed as the same
// patch shape parseTaskPatch accepts, so bulk and single-row edits share ONE
// validator and ONE server write path (taskService).
//
// Pure: no Prisma, no I/O.

export const BULK_ACTIONS = Object.freeze([
  'complete',
  'cancel',
  'assign_owner',
  'set_due_date',
  'set_due_time',
  'set_priority',
  'set_type',
]);

// Bound per request. The grid page is ≤100 rows, so this is generous; a bigger
// selection is split by the CLIENT into successive requests, keeping each HTTP
// call — and each per-row failure report — a rollback point of sane size.
export const MAX_BULK_IDS = 200;

// How the route processes ids: sequentially in slices of this size, each task
// its own transaction (transitionTask already wraps one). Partial failure is
// the NORMAL case and is reported per row — never a silent success.
export const BULK_CHUNK_SIZE = 25;

/**
 * @returns {{ok:true, action:string, ids:string[], patch:object|null}
 *          | {ok:false, error:string}}
 * `patch` is null for transitions; for field edits it is the parseTaskPatch
 * body the service will validate again (one validator, not two).
 */
export function parseBulkRequest(body) {
  const b = body || {};

  const action = String(b.action || '');
  if (!BULK_ACTIONS.includes(action)) return { ok: false, error: 'invalid_action' };

  const raw = Array.isArray(b.ids) ? b.ids : null;
  if (!raw || !raw.length) return { ok: false, error: 'ids_required' };
  const ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) return { ok: false, error: 'ids_required' };
  if (ids.length > MAX_BULK_IDS) return { ok: false, error: 'too_many_ids' };

  let patch = null;
  switch (action) {
    case 'complete':
    case 'cancel':
      break;
    case 'assign_owner':
      if (!String(b.ownerUserId || '').trim()) return { ok: false, error: 'owner_required' };
      patch = { ownerUserId: String(b.ownerUserId).trim() };
      break;
    case 'set_due_date':
      if (!b.dueDate) return { ok: false, error: 'due_date_required' };
      patch = { dueDate: b.dueDate };
      break;
    case 'set_due_time':
      // null/'' clears the time — a legitimate bulk edit.
      patch = { dueTime: b.dueTime || null };
      break;
    case 'set_priority':
      // 'none' clears priority; parseTaskPatch normalises the vocabulary.
      patch = { priority: b.priority === 'none' ? null : b.priority ?? null };
      break;
    case 'set_type':
      if (!String(b.taskTypeId || '').trim()) return { ok: false, error: 'task_type_required' };
      patch = { taskTypeId: String(b.taskTypeId).trim() };
      break;
    default:
      return { ok: false, error: 'invalid_action' };
  }

  return { ok: true, action, ids, patch };
}

/** Split ids into processing slices (see BULK_CHUNK_SIZE). */
export function chunkIds(ids, size = BULK_CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Fold per-row results into the response envelope. Failures stay per-row. */
export function summarizeResults(results) {
  const failed = results.filter((r) => !r.ok);
  return {
    results,
    total: results.length,
    succeeded: results.length - failed.length,
    failed: failed.length,
  };
}
