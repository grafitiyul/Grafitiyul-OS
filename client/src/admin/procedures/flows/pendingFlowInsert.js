// Small helper for "create item from inside a flow": stash the target flow
// + picker-context in sessionStorage, then use it to insert the freshly-
// created item when the user finishes editing in the main editor.
//
// sessionStorage lets the state survive a navigate() across routes without
// introducing a broader URL schema or a global store.

import { api } from '../../../lib/api.js';
import { insertAfter, uid } from './treeOps.js';

const KEY = 'gos.pendingFlowInsert.v1';

/**
 * Stash a pending-insert context.
 *   flowId         — flow to insert into
 *   pickerContext  — { mode: 'into'|'after', parentId?, afterId? }
 */
export function setPending(flowId, pickerContext) {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ flowId, pickerContext, at: Date.now() }),
    );
  } catch {
    /* ignore quota */
  }
}

export function getPending() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPending() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Add an existing item (content or question) to the pending flow at its
 * stored picker context, then save the flow. Returns { flowId } on success.
 * Does NOT navigate — the caller controls navigation so it can show
 * "saving…" UI in its own header first if desired.
 */
export async function commitPending(kind, itemId, itemData) {
  const pending = getPending();
  if (!pending) throw new Error('no_pending_insert');
  const { flowId, pickerContext } = pending;
  const flow = await api.flows.get(flowId);
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];

  const newNode = makeItemNode(kind, itemId, itemData);
  let next;
  if (pickerContext?.mode === 'after' && pickerContext.afterId) {
    next = insertAfter(nodes, pickerContext.afterId, newNode);
  } else {
    const parentId = pickerContext?.parentId || null;
    const siblings = nodes.filter((n) => (n.parentId ?? null) === parentId);
    next = [
      ...nodes,
      {
        ...newNode,
        parentId: parentId || null,
        order: siblings.length,
      },
    ];
  }

  // Minimal server shape — matches FlowEditor.toServerShape (which is
  // private, so we recreate its essential projection here).
  const serverNodes = next.map((n) => ({
    id: n.id,
    parentId: n.parentId || null,
    order: n.order ?? 0,
    kind: n.kind,
    contentItemId: n.contentItemId || null,
    questionItemId: n.questionItemId || null,
    groupTitle: n.groupTitle || null,
    checkpointAfter: !!n.checkpointAfter,
  }));

  await api.flows.saveNodes(flowId, serverNodes);
  clearPending();
  return { flowId };
}

function makeItemNode(kind, itemId, itemData) {
  return {
    id: uid(),
    kind,
    contentItemId: kind === 'content' ? itemId : null,
    questionItemId: kind === 'question' ? itemId : null,
    contentItem: kind === 'content' ? itemData : null,
    questionItem: kind === 'question' ? itemData : null,
    groupTitle: null,
    order: 0,
    checkpointAfter: false,
  };
}
