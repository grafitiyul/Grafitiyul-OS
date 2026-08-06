import Dialog from '../common/Dialog.jsx';
import EmailThreadView from './EmailThreadView.jsx';

// Reading and answering an email conversation is WORK, not a confirmation — so
// it gets a workspace, at the same scale as the confirmation-email and quote
// previews, rather than a panel squeezed into a CRM tab. The thread used to
// replace the Deal's email list in place, which meant reading a long exchange
// inside a narrow column and losing the list to get back to it.
//
// The BODY is the canonical EmailThreadView, untouched: chronological messages,
// expand/collapse, sender/recipients/CC/timestamps, attachments, reply /
// reply-all / forward with quoted history, sending through the thread's own
// Gmail account, refresh after send, and mark-as-read on open. This component
// contributes the frame and nothing else — there is no second thread renderer.
//
// Deal and Contact both open THIS modal, so the two surfaces cannot drift.

export default function EmailThreadModal({ open, thread, dealId = null, contactId = null, onClose, onChanged }) {
  if (!thread) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      // xl — the working width of the other reading workspaces in GOS.
      size="xl"
      ariaLabel="שיחת מייל"
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[15px]">✉️</span>
          <span className="min-w-0 truncate" dir="auto">{thread.subject || '(ללא נושא)'}</span>
        </span>
      }
      contentClassName="flex flex-col overflow-hidden"
    >
      {/* The thread scrolls INSIDE the panel — the dialog frame stays put, so
          the subject and the close action never scroll away from a long
          exchange. min-h keeps a short thread from collapsing to a sliver. */}
      <div dir="rtl" className="min-h-[45vh] max-h-[78vh] overflow-y-auto px-4 pb-4 pt-3">
        <EmailThreadView
          key={thread.id}
          threadId={thread.id}
          dealId={dealId}
          contactId={contactId}
          onChanged={onChanged}
        />
      </div>
    </Dialog>
  );
}
