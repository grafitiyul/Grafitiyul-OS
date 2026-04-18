import { useEffect, useRef, useState } from 'react';

// Vertical resize handle sitting between the list pane and the work area.
// Desktop-only (hidden on mobile). RTL-aware: the list pane is on the
// leading (right) edge, so dragging the handle LEFT widens the pane.
export default function ResizeHandle({
  currentWidth,
  onResize,
  minWidth = 240,
  maxWidth = 640,
  ariaLabel = 'שינוי רוחב',
}) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e) {
      // In RTL layout: clientX decreasing = moved left = widen the aside.
      const delta = startX.current - e.clientX;
      const next = Math.max(
        minWidth,
        Math.min(maxWidth, startWidth.current + delta),
      );
      onResize(next);
    }
    function onUp() {
      setDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging, onResize, minWidth, maxWidth]);

  function onDown(e) {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = currentWidth;
    setDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }

  function onDoubleClick() {
    // Reset to default mid-range width.
    const mid = Math.round((minWidth + maxWidth) / 2);
    onResize(Math.max(minWidth, Math.min(maxWidth, 360)));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onMouseDown={onDown}
      onDoubleClick={onDoubleClick}
      className={`hidden lg:block shrink-0 cursor-col-resize transition-colors duration-150 ${
        dragging
          ? 'bg-blue-500'
          : 'bg-gray-200 hover:bg-blue-400 focus:bg-blue-400'
      }`}
      style={{ width: 4 }}
    />
  );
}
