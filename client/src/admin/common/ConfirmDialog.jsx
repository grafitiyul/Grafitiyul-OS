import Dialog from './Dialog.jsx';

// In-system replacement for window.confirm. Supports a destructive variant
// (red confirm button) for delete flows.
export default function ConfirmDialog({
  open,
  title = 'אישור',
  body,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  danger = false,
  onCancel,
  onConfirm,
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`text-sm text-white rounded px-4 py-1.5 font-medium ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {typeof body === 'string' ? (
        <p className="text-sm text-gray-800 whitespace-pre-wrap">{body}</p>
      ) : (
        body
      )}
    </Dialog>
  );
}
