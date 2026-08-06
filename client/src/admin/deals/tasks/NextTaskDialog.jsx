import Dialog from '../../common/Dialog.jsx';
import TaskComposer from './TaskComposer.jsx';

// "מה הצעד הבא?" — offered when the LAST open task on an OPEN deal is
// completed, because a live deal with nothing scheduled next is how a lead goes
// quiet.
//
// It is a FRAME around the canonical TaskComposer and nothing else: same task
// types, same fields, same owner/date/time/priority rules, same validation,
// same draft store, same create endpoint. There is no second task
// implementation and no duplicated field logic — if the composer changes, this
// changes with it.
//
// Why a dialog and not the composer's משימה tab: completing a task must not
// move the operator off the work they are doing. Switching tabs unmounted
// whatever was open underneath — a half-written note, an email draft, the
// WhatsApp panel — which made a helpful prompt feel like the system yanking
// the desk out from under you. A dialog leaves the tab mounted and untouched,
// which is also exactly how the composer's OTHER modal action already behaves
// (MODAL_TABS / תבנית ווטסאפ in TimelineFeed).
//
// It is an OFFER, never a write: closing it creates nothing.

export default function NextTaskDialog({ open, dealId, onClose, onCreated }) {
  if (!open) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      ariaLabel="משימה הבאה"
      title={
        <span className="flex items-center gap-2">
          <span aria-hidden>✅</span>
          מה הצעד הבא?
        </span>
      }
      contentClassName="flex flex-col overflow-y-auto"
    >
      <div dir="rtl" className="space-y-3 px-4 pb-4 pt-3">
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-[12.5px] leading-relaxed text-blue-800 ring-1 ring-blue-100">
          סיימתם את המשימה האחרונה בדיל הזה, והוא עדיין פתוח. אפשר לקבוע כאן את
          המשימה הבאה — או פשוט לסגור, ולא ייווצר כלום.
        </p>
        {/* The REAL composer. Keyed by deal so it rehydrates that deal's draft,
            exactly like the tab mounts it. */}
        <TaskComposer key={dealId} dealId={dealId} onCreated={onCreated} />
      </div>
    </Dialog>
  );
}
