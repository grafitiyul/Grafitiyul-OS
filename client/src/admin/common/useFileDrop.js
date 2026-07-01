import { useCallback, useRef, useState } from 'react';

// Shared "click OR drag-and-drop" file-input behavior for every upload field in
// GOS. This is intentionally headless: it does NOT upload anything and holds no
// storage logic — the caller passes `onFiles(files)` and keeps using the
// existing upload API (uploadImage / api.*.uploadImage). One place owns picking,
// drag-over state, and validation; each field keeps its own visuals.
//
// Why validation lives here: the native file picker already filters by `accept`,
// but a DROPPED file does not go through the picker, so the browser won't filter
// it. We re-check the dropped file's type against `accept` (and an optional
// `maxBytes`) so drop behaves exactly like choosing from the picker — same
// validation as today, no looser.
//
// Returns:
//   dragOver   – boolean, true while a file is dragged over the area (for styling)
//   open()     – trigger the file picker (wire to a button / click handler)
//   dropProps  – spread onto the drop area element (drag/drop handlers)
//   inputProps – spread onto a hidden <input type="file"> element
export function useFileDrop({
  accept = 'image/*',
  multiple = false,
  maxBytes = 0,
  disabled = false,
  onFiles,
  onReject,
} = {}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  // Depth counter: dragenter/dragleave fire for child elements too, so a plain
  // boolean would flicker. Counting enters minus leaves tracks the real state.
  const dragDepth = useRef(0);

  const accepts = useCallback(
    (file) => {
      if (!accept || accept === '*' || accept === '*/*') return true;
      const type = (file.type || '').toLowerCase();
      const name = (file.name || '').toLowerCase();
      return accept
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .some((rule) => {
          if (rule.startsWith('.')) return name.endsWith(rule); // .pdf
          if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1)); // image/*
          return type === rule; // exact mime, e.g. application/pdf
        });
    },
    [accept],
  );

  const handleFiles = useCallback(
    (fileList) => {
      let files = Array.from(fileList || []);
      if (!files.length) return;
      if (!multiple) files = files.slice(0, 1);
      const valid = [];
      for (const f of files) {
        if (!accepts(f)) {
          onReject?.({ file: f, reason: 'type' });
          continue;
        }
        if (maxBytes && f.size > maxBytes) {
          onReject?.({ file: f, reason: 'size' });
          continue;
        }
        valid.push(f);
      }
      if (valid.length) onFiles?.(valid);
    },
    [accepts, maxBytes, multiple, onFiles, onReject],
  );

  const onDragOver = useCallback(
    (e) => {
      if (disabled) return;
      e.preventDefault(); // required so the browser allows a drop
    },
    [disabled],
  );
  const onDragEnter = useCallback(
    (e) => {
      if (disabled) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragOver(true);
    },
    [disabled],
  );
  const onDragLeave = useCallback(
    (e) => {
      if (disabled) return;
      e.preventDefault();
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragOver(false);
      }
    },
    [disabled],
  );
  const onDrop = useCallback(
    (e) => {
      if (disabled) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      handleFiles(e.dataTransfer?.files);
    },
    [disabled, handleFiles],
  );

  const open = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const onInputChange = useCallback(
    (e) => {
      handleFiles(e.target.files);
      if (inputRef.current) inputRef.current.value = ''; // allow re-picking same file
    },
    [handleFiles],
  );

  return {
    dragOver,
    open,
    dropProps: { onDragOver, onDragEnter, onDragLeave, onDrop },
    inputProps: {
      ref: inputRef,
      type: 'file',
      accept,
      multiple,
      onChange: onInputChange,
      className: 'hidden',
    },
  };
}
