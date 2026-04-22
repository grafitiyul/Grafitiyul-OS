// Generic position/insertion logic for sortable trees.
//
// Pure, data-shape-agnostic. Input is a flat ordered array of `rows`
// (the visible display order), plus hover state; output is a structured
// insertion point that consumers translate into their own backing data
// (flat list with `folderId`, recursive tree with `parentId`, etc).
//
// Row shape:
//   {
//     id:           string      stable unique DnD id
//     parentId:     string|null id of parent row (null = root)
//     depth:        number      0 = root, 1+ = nested
//     isContainer:  boolean     can accept children
//     acceptsKinds: string[]    which active kinds this row accepts as
//                               children (null/undefined = accept any)
//     collapsed:    boolean     containers only; children hidden
//     meta:         any         opaque consumer payload
//   }
//
// Consumers used today:
//   * Bank flat-with-folders — folders are containers at depth 0, items
//     are leaves at depth 1. Root accepts only folders (items always
//     live inside a folder or inside the synthetic "ungrouped" bucket).
//
// Consumers used later:
//   * Flow recursive tree — groups are containers at any depth, items
//     are leaves, and both can live at root. Works without change; just
//     pass `rootAccepts` accordingly.

// Compute the insertion point for a drag.
//
// Returns null if there is no valid drop position, else:
//   {
//     parentId:      string|null  parent row id (null = root)
//     indexInParent: number       0-based index among parent's children
//     flatIndex:     number       index in `rows` BEFORE which the
//                                 DropIndicator should be rendered
//     depth:         number       visual indent depth of the indicator
//   }
//
// Arguments:
//   rows:         Row[]          flattened tree in display order
//   activeIds:    Set<string>    ids being dragged (filtered out of
//                                candidate targets to prevent dropping
//                                into self)
//   activeKind:   string         kind of the active drag (e.g. 'item')
//   overId:       string         hovered row id
//   overRect:     DOMRect        hovered element's bounding rect
//   pointerY:     number         cursor clientY — vs the row's vertical
//                                midpoint decides before/after
//   descendants:  (id) => Set    optional resolver for descendant sets
//                                (prevents cycles when containers can
//                                nest). For Bank this is a no-op; for
//                                Flow it walks the tree.
//   rootAccepts:  string[]|null  which kinds may live at root; null
//                                means root accepts anything.
export function computeInsertion({
  rows,
  activeIds,
  activeKind,
  overId,
  overRect,
  pointerY,
  descendants,
  rootAccepts = null,
}) {
  if (!overId || !overRect) return null;
  const overIdx = rows.findIndex((r) => r.id === overId);
  if (overIdx < 0) return null;
  const over = rows[overIdx];

  // Cycle prevention — active subtree is off-limits as a target.
  const bad = new Set(activeIds);
  if (descendants) {
    for (const aid of activeIds) {
      const d = descendants(aid);
      if (d) for (const x of d) bad.add(x);
    }
  }
  if (bad.has(overId)) return null;

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const parentOf = (row) =>
    row.parentId == null ? null : rowById.get(row.parentId) || null;

  function localIndex(row) {
    let idx = 0;
    for (const r of rows) {
      if ((r.parentId || null) === (row.parentId || null)) {
        if (r.id === row.id) return idx;
        idx++;
      }
    }
    return -1;
  }

  // "Can `parent` accept a child of `activeKind`?" null parent = root.
  function accepts(parent) {
    if (parent == null) {
      if (!rootAccepts) return true;
      return rootAccepts.includes(activeKind);
    }
    if (bad.has(parent.id)) return false;
    if (!parent.isContainer) return false;
    if (!Array.isArray(parent.acceptsKinds)) return true;
    return parent.acceptsKinds.includes(activeKind);
  }

  function pack(parent, indexInParent, flatIndex) {
    return {
      parentId: parent ? parent.id : null,
      indexInParent,
      flatIndex,
      depth: parent ? parent.depth + 1 : 0,
    };
  }

  // Vertical position within the hovered row, 0..1.
  const fractionY =
    overRect.height > 0
      ? (pointerY - overRect.top) / overRect.height
      : 0.5;

  // ── Leaf row (non-container) ──
  // Two zones: above midpoint = sibling-before, below = sibling-after.
  if (!over.isContainer) {
    const parent = parentOf(over);
    if (!accepts(parent)) return null;
    if (fractionY < 0.5) return pack(parent, localIndex(over), overIdx);
    return pack(parent, localIndex(over) + 1, overIdx + 1);
  }

  // ── Container row ──
  // Three zones: top 10% = sibling-before, middle 80% = INTO container,
  // bottom 10% = sibling-after. Widened from 25/50/25 because the
  // middle zone is the PRIMARY action for a container (the whole point
  // of landing on a folder row is to put something in it). Sibling
  // drops are precise gestures aimed at the row's top / bottom edge.
  // This matches the Notion / Linear pattern where most of a
  // container row is "drop inside" and only a thin edge is "between".
  //
  // Fallbacks when a zone's natural target doesn't accept the kind:
  //   * sibling-before → into container
  //   * into container → sibling-after
  //   * sibling-after → into container (last resort for collapsed
  //     containers that nothing else accepts)
  const parent = parentOf(over);

  if (fractionY < 0.1) {
    if (accepts(parent)) return pack(parent, localIndex(over), overIdx);
    if (accepts(over)) return pack(over, 0, overIdx + 1);
    return null;
  }

  if (fractionY < 0.9) {
    if (!over.collapsed && accepts(over)) return pack(over, 0, overIdx + 1);
    if (accepts(parent)) {
      // Container rejects this kind — treat middle as sibling-after.
      let end = overIdx;
      for (let i = overIdx + 1; i < rows.length; i++) {
        if (rows[i].depth > over.depth) end = i;
        else break;
      }
      return pack(parent, localIndex(over) + 1, end + 1);
    }
    if (accepts(over)) return pack(over, 0, overIdx + 1);
    return null;
  }

  // Bottom 25%.
  if (accepts(parent)) {
    let end = overIdx;
    for (let i = overIdx + 1; i < rows.length; i++) {
      if (rows[i].depth > over.depth) end = i;
      else break;
    }
    return pack(parent, localIndex(over) + 1, end + 1);
  }
  if (accepts(over)) return pack(over, 0, overIdx + 1);
  return null;
}

// Build the ordered list of children the target parent will have after
// the move lands. Consumers typically feed this into a reorder endpoint
// that sets (parent, order) atomically.
//
// Args:
//   targetChildren:   current children of target parent, in order
//   insertionIndex:   position within that parent (from computeInsertion)
//   movedRows:        rows being moved, in the order they should land
//
// Dragged rows that are already children of the target are first
// removed, then re-inserted at the insertion index. Multi-drag preserves
// the moved rows' relative order.
export function buildTargetOrder({
  targetChildren,
  insertionIndex,
  movedRows,
}) {
  const movedIds = new Set(movedRows.map((r) => r.id));
  const without = targetChildren.filter((c) => !movedIds.has(c.id));
  const idx = Math.max(0, Math.min(insertionIndex, without.length));
  return [...without.slice(0, idx), ...movedRows, ...without.slice(idx)];
}
