// Tree operations for the flow builder. Nodes live as a flat array in
// state (matching the server shape). The tree is only a rendering
// projection — `buildTree` / `flattenTree` round-trip cleanly.

export function uid() {
  return 'n_' + Math.random().toString(36).slice(2, 12);
}

// Build a tree from the flat node list. Each returned node carries
// `children: []` populated by parentId lookup. Siblings sorted by `order`.
export function buildTree(flat) {
  const byId = new Map();
  for (const n of flat) {
    byId.set(n.id, { ...n, children: [] });
  }
  const roots = [];
  for (const n of byId.values()) {
    if (n.parentId && byId.has(n.parentId)) {
      byId.get(n.parentId).children.push(n);
    } else {
      roots.push(n);
    }
  }
  function sortRec(arr) {
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const n of arr) if (n.children.length) sortRec(n.children);
  }
  sortRec(roots);
  return roots;
}

// Flatten a tree back to an array suitable for PUT /api/flows/:id/nodes.
// Rewrites parentId and order from the tree's current structure so the
// server sees a consistent snapshot.
export function flattenTree(tree) {
  const out = [];
  function walk(nodes, parentId) {
    nodes.forEach((n, idx) => {
      const { children, ...rest } = n;
      out.push({ ...rest, parentId: parentId || null, order: idx });
      if (children?.length) walk(children, n.id);
    });
  }
  walk(tree, null);
  return out;
}

// Visible-order list for rendering: [{ node, depth }, ...].
// Skips descendants of collapsed groups.
export function flattenVisible(tree, collapsedIds) {
  const out = [];
  function walk(nodes, depth) {
    for (const n of nodes) {
      out.push({ node: n, depth });
      const isGroup = n.kind === 'group';
      if (isGroup && n.children?.length && !collapsedIds[n.id]) {
        walk(n.children, depth + 1);
      }
    }
  }
  walk(tree, 0);
  return out;
}

// Count items recursively under a group (not counting other groups).
export function countItems(node) {
  if (node.kind !== 'group') return 1;
  let n = 0;
  for (const c of node.children || []) {
    n += countItems(c);
  }
  return n;
}

// Does `maybeDescId` live anywhere under `ancestorId` in the flat array?
// Used to block drops that would put a group inside itself or one of its
// descendants (which would orphan a subtree).
export function isDescendant(flat, ancestorId, maybeDescId) {
  let cur = flat.find((n) => n.id === maybeDescId);
  const guard = new Set();
  while (cur?.parentId && !guard.has(cur.id)) {
    guard.add(cur.id);
    if (cur.parentId === ancestorId) return true;
    cur = flat.find((n) => n.id === cur.parentId);
  }
  return false;
}

// Move the `activeId` node to a new position relative to `overId`.
// `position`: 'before' | 'after' | 'inside'
// - 'inside' is only honored when overId is a group; the active node
//   is inserted as the first child.
// Returns a new flat array with parentId + order normalised. Returns
// the original array unchanged if the move would create a cycle or no-op.
export function applyMove(flat, activeId, overId, position) {
  if (!activeId || !overId || activeId === overId) return flat;
  if (isDescendant(flat, activeId, overId)) return flat;

  const tree = buildTree(flat);

  // Remove the active subtree from wherever it currently sits.
  let extracted = null;
  function remove(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === activeId) {
        extracted = nodes[i];
        nodes.splice(i, 1);
        return true;
      }
      if (nodes[i].children?.length && remove(nodes[i].children)) return true;
    }
    return false;
  }
  remove(tree);
  if (!extracted) return flat;

  // Insert at the target.
  function insert(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.id === overId) {
        if (position === 'before') {
          nodes.splice(i, 0, extracted);
        } else if (position === 'after') {
          nodes.splice(i + 1, 0, extracted);
        } else if (position === 'inside' && n.kind === 'group') {
          n.children = n.children || [];
          n.children.unshift(extracted);
        } else {
          // Fallback: sibling after if 'inside' landed on a non-group.
          nodes.splice(i + 1, 0, extracted);
        }
        return true;
      }
      if (n.children?.length && insert(n.children)) return true;
    }
    return false;
  }
  if (!insert(tree)) {
    // over target disappeared — restore by pushing to root (shouldn't happen).
    tree.push(extracted);
  }

  return flattenTree(tree);
}

// Remove the node and all its descendants from the flat array.
export function removeSubtree(flat, nodeId) {
  const toRemove = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of flat) {
      if (n.parentId && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
        toRemove.add(n.id);
        changed = true;
      }
    }
  }
  return flat.filter((n) => !toRemove.has(n.id));
}
