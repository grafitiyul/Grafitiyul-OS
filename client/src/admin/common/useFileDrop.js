import { useCallback, useRef, useState } from 'react';
import { pickAcceptedFiles } from './fileAccept.js';

// Shared "click OR drag-and-drop" file-input behavior for every upload field in
// GOS. Headless: it does NOT upload and holds no storage logic — the caller
// passes `onFiles(files)` and keeps using the existing upload API
// (uploadImage / api.*.uploadImage). One place owns picking, drag-over state,
// and validation; each field keeps its own visuals.
//
// This mirrors the proven native-drop pattern already used by PdfViewer:
//   - onDragOver MUST call preventDefault (or the browser rejects the drop and
//     just navigates to the file) AND set dataTransfer.dropEffect = 'copy' so
//     the OS shows a copy cursor and allows the drop.
//   - dragleave fires when the pointer moves onto CHILD elements too, so we only
//     clear the drag-over state when the pointer truly leaves the container
//     (relatedTarget is outside currentTarget). This avoids the flicker that a
//     naive boolean/among-children counter produces — flicker that can drop
//     preventDefault on a frame and make the whole drop fail.
//   - drop-zone overlays must be pointer-events-none (enforced by callers) so
//     they never sit between the pointer and the drop handlers.
//
// Validation of DROPPED files is delegated to the same pure pickAcceptedFiles
// used conceptually for the picker, so drop enforces the same accept/size rules.
//
// Returns:
//   dragOver   – boolean, true while a file is dragged over the area (styling)
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

  const handleFiles = useCallback(
    (fileList) => {
      const { accepted, rejected } = pickAcceptedFiles(fileList, { accept, multiple, maxBytes });
      if (rejected.length) onReject?.(rejected);
      if (accepted.length) onFiles?.(accepted);
    },
    [accept, multiple, maxBytes, onFiles, onReject],
  );

  const onDragOver = useCallback(
    (e) => {
      if (disabled) return;
      // Both are required for a native file drop to be accepted.
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch {
        /* some browsers lock dataTransfer during dragover — safe to ignore */
      }
      setDragOver(true); // React no-ops if already true
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (e) => {
      if (disabled) return;
      // Ignore leaves onto descendant elements — only clear on a real exit.
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDragOver(false);
    },
    [disabled],
  );

  const onDrop = useCallback(
    (e) => {
      if (disabled) return;
      e.preventDefault();
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
    dropProps: { onDragOver, onDragLeave, onDrop },
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
