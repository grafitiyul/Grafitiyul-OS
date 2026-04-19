import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';

// In-system replacement for window.prompt. Single text input, OK + Cancel.
// onSubmit(value) gets the trimmed string. Empty submit is blocked.
export default function PromptDialog({
  open,
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  onClose,
  onSubmit,
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(t);
    }
  }, [open]);

  function submit(e) {
    e?.preventDefault();
    const clean = value.trim();
    if (!clean) return;
    onSubmit(clean);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="text-sm bg-blue-600 text-white rounded px-4 py-1.5 font-medium disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-2">
        {label && (
          <label className="block text-sm text-gray-700">{label}</label>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
        />
      </form>
    </Dialog>
  );
}
