import { useRef, useState } from 'react';

// THE task completion control — one component wherever a task can be ticked
// off: the Deal's open-tasks strip, the Tasks table, the Tasks cards, and any
// surface reached through the record drawer. One component is the only way
// "click → done" can mean the same thing in all of them.
//
// Two rules it exists to enforce:
//
// 1. NOTHING APPEARS OR DISAPPEARS ON HOVER. The old control drew a ✓ in
//    `text-transparent` and revealed it with `hover:text-green-600`, so pointing
//    at a task previewed it as already completed — confusing to read and jumpy
//    to scan. Hover now changes only the border and the fill. The box is a
//    fixed 20×20 in every state, and the ✓ glyph is always in the DOM (the OPEN
//    state simply paints it transparent AND leaves the space reserved), so no
//    state change can shift a single pixel of the row around it.
//
// 2. THE CONTROL IS A TOGGLE. Clicking a completed task's check reopens it
//    through the canonical reopen transition — the same row, same id, history
//    preserved (taskService.reopenTask). No confirmation: the action is
//    reversible by the same click that caused it.
//
// A SENT WhatsApp task is genuinely final — the message went out — so it renders
// checked and inert rather than pretending it can be undone.
//
// While a request is in flight the control is locked, so a double click cannot
// flip the task twice. On failure the caller's handler rejects and the visual
// state simply returns to what the task actually is — the control never keeps
// an optimistic state the server refused.

const BOX = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[12px] leading-none transition-colors';

export default function TaskCheckbox({
  status,
  onComplete,
  onReopen,
  busy = false,
  className = '',
  stopPropagation = true,
}) {
  const [pending, setPending] = useState(false);
  // A ref, not the state, is what actually blocks the second click: two clicks
  // in the same tick would both read `pending === false`.
  const inFlight = useRef(false);

  const completed = status === 'completed';
  const terminal = status !== 'open';
  const final = status === 'sent'; // the message was sent — nothing to undo
  const action = final ? null : terminal ? onReopen : onComplete;
  const disabled = busy || pending || !action;

  async function click(e) {
    if (stopPropagation) e.stopPropagation();
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await action();
    } catch {
      /* the caller owns the error UX; the control just unlocks and re-reads
         `status`, which is still whatever the server says it is */
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const tone = final
    ? 'border-gray-300 bg-gray-100 text-gray-400 cursor-default'
    : terminal
      ? 'border-emerald-500 bg-emerald-500 text-white hover:border-emerald-600 hover:bg-emerald-600'
      : 'border-gray-300 bg-white text-transparent hover:border-emerald-500 hover:bg-emerald-50';

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={terminal}
      aria-label={terminal ? 'פתיחת המשימה מחדש' : 'סימון המשימה כהושלמה'}
      title={final ? 'הודעה שנשלחה — סופי' : terminal ? 'פתיחה מחדש — המשימה חוזרת לפתוחה, ההיסטוריה נשמרת' : 'סימון כהושלמה'}
      data-task-check={terminal ? (final ? 'final' : 'done') : 'open'}
      disabled={disabled}
      onClick={click}
      className={`${BOX} ${tone} ${disabled && !terminal ? 'opacity-50' : ''} ${className}`}
    >
      {/* Always rendered — its colour is the state, never its presence. */}
      <span aria-hidden>✓</span>
    </button>
  );
}
