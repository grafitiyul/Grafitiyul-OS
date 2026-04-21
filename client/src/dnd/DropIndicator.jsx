// Reusable drop-indicator line for sortable trees.
//
// Renders a thick horizontal bar that spans the list width, offset by the
// target parent's indent so the visual position communicates BOTH where
// (between which items) and AT WHAT DEPTH (root vs inside folder vs inside
// nested group) the drop will land.
//
// Not tied to any particular data shape: callers pass `depth` (0 = root,
// 1 = first level of nesting, etc.) and `indent` (px per depth level).
// Ship the same component in the flow editor later by passing its own
// indent value.

export default function DropIndicator({ depth = 0, indent = 24 }) {
  return (
    <div
      className="relative pointer-events-none"
      style={{ height: 0 }}
      aria-hidden
      data-drop-indicator
    >
      <div
        className="absolute h-[2.5px] bg-blue-500 rounded-full shadow-[0_0_0_1px_rgba(59,130,246,0.25)]"
        style={{
          insetInlineStart: `${depth * indent}px`,
          insetInlineEnd: 0,
          top: -1.25,
        }}
      >
        <div
          className="absolute w-2.5 h-2.5 bg-blue-500 rounded-full"
          style={{
            insetInlineStart: -4,
            top: -4,
          }}
        />
      </div>
    </div>
  );
}
