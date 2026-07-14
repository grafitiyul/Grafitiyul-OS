import Dialog from './Dialog.jsx';

// In-system replacement for window.alert — one message, one dismiss button.
// `tone` colours the message: 'error' (default — API/validation failures) or
// 'notice' (informational, e.g. build warnings the user must read).
export default function AlertDialog({
  open,
  title = 'שגיאה',
  body,
  closeLabel = 'הבנתי',
  tone = 'error',
  onClose,
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="text-sm bg-blue-600 text-white rounded px-4 py-1.5 font-medium hover:bg-blue-700"
        >
          {closeLabel}
        </button>
      }
    >
      <p
        className={`text-sm whitespace-pre-wrap ${tone === 'error' ? 'text-red-700' : 'text-gray-800'}`}
      >
        {body}
      </p>
    </Dialog>
  );
}
