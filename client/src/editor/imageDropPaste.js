import { uploadMediaWithProgress, ALLOWED_IMAGE_MIME } from './mediaUpload.js';

// Drag-and-drop / clipboard-paste image upload for RichEditor.
//
// One rule everywhere: an image dropped or pasted into an editor rides the SAME
// upload path as the toolbar's image button (/api/media/upload → MediaAsset →
// mediaImage node) and the SAME UploadBanner feedback. This module holds the
// pure decision helpers (unit-testable, DOM-free) plus the sequential
// upload-and-insert runner; RichEditor wires them into ProseMirror's
// handleDrop / handlePaste.

// Split a dropped/pasted FileList by the canonical editor image allowlist.
export function splitImageFiles(fileList) {
  const files = Array.from(fileList || []);
  return {
    images: files.filter((f) => ALLOWED_IMAGE_MIME.has(f.type)),
    others: files.filter((f) => !ALLOWED_IMAGE_MIME.has(f.type)),
  };
}

// Should a paste event be handled as a direct image upload?
// Only the "pure file" paste (screenshot, copied image file) qualifies — when
// the clipboard also carries text/html (copying content from a web page or a
// Word doc), the existing sanitized-HTML paste path must keep owning it.
export function isImageFilePaste(clipboardData) {
  const files = Array.from(clipboardData?.files || []);
  if (!files.length) return false;
  const types = Array.from(clipboardData?.types || []);
  if (types.includes('text/html')) return false;
  return files.some((f) => ALLOWED_IMAGE_MIME.has(f.type));
}

// Upload `files` one after another and insert each as a mediaImage at `pos`
// (drop coordinates) or the current selection (paste). Mirrors the toolbar's
// runUpload contract for UploadBanner: uploading (with percent + cancel) →
// success (auto-dismissed) / error. A failure or cancel stops the remaining
// queue; images already inserted stay — nothing is silently lost.
export function uploadImagesIntoEditor({ editor, files, pos = null, setUploadState, skippedCount = 0 }) {
  const list = Array.from(files || []);
  if (!list.length || !editor) return Promise.resolve();

  const ctrl = { aborted: false, current: null };
  const cancel = () => {
    ctrl.aborted = true;
    ctrl.current?.abort?.();
  };

  const labelFor = (i) =>
    list.length > 1 ? `מעלה תמונה (${i + 1}/${list.length})` : 'מעלה תמונה';

  return (async () => {
    let insertAt = pos;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const label = labelFor(i);
      setUploadState({ phase: 'uploading', label, percent: 0, cancel });
      try {
        ctrl.current = uploadMediaWithProgress(file, 'image', (p) => {
          if (ctrl.aborted) return;
          setUploadState({
            phase: 'uploading',
            label,
            percent: typeof p.percent === 'number' ? p.percent : null,
            cancel,
          });
        });
        const asset = await ctrl.current;
        if (ctrl.aborted) return;
        let chain = editor.chain().focus(undefined, { scrollIntoView: false });
        if (insertAt != null) chain = chain.setTextSelection(insertAt);
        chain
          .setImage({ src: asset.url, alt: (file.name || '').replace(/\.[^.]+$/, '') })
          .run();
        // Subsequent images follow the cursor (which now sits after the
        // inserted node) — only the first insert targets the drop position.
        insertAt = null;
      } catch (err) {
        if (err?.message === 'bcancel' || ctrl.aborted) {
          setUploadState({ phase: 'idle' });
          return;
        }
        setUploadState({ phase: 'error', error: err?.message || 'העלאה נכשלה' });
        return;
      }
    }
    const doneLabel =
      (list.length > 1 ? `הועלו ${list.length} תמונות` : 'העלאת תמונה') +
      ' — הושלם' +
      (skippedCount ? ` (${skippedCount} קבצים שאינם תמונה דולגו)` : '');
    setUploadState({ phase: 'success', label: doneLabel });
    setTimeout(() => {
      setUploadState((prev) => (prev?.phase === 'success' ? { phase: 'idle' } : prev));
    }, 2200);
  })();
}
