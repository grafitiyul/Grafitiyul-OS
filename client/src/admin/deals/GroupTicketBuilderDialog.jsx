import { useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import GroupTicketBuilder from './GroupTicketBuilder.jsx';
import WaiverDecisionDialog from './WaiverDecisionDialog.jsx';

// Standalone Group Ticket Builder editor — a thin Dialog shell around the shared
// GroupTicketBuilder body (the ONE implementation of the ticket workspace, also
// embedded inline in the progressive GroupRegistrationModal). Kept for the
// DealDetail "כרטיסים" entry and the Quote canvas; saving is delegated to the
// body via a ref so there is no duplicated calculation/persistence.
//
// Waiver decision: when the deal is registered WITHOUT PAYMENT and the builder is
// INCREASED, the server returns 409 waiver_decision_required. We surface the
// system WaiverDecisionDialog and re-save with the operator's explicit choice.

export default function GroupTicketBuilderDialog({ open, deal, context, onClose, onSaved }) {
  const builderRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [waiverPrompt, setWaiverPrompt] = useState(null); // { added } | null
  if (!open) return null;

  async function saveAndClose(waiverDecision) {
    setSaving(true);
    try {
      const r = await builderRef.current?.save(waiverDecision ? { waiverDecision } : {});
      if (r?.ok) {
        setWaiverPrompt(null);
        await onSaved?.();
        onClose?.();
      }
    } catch (e) {
      if (e.code === 'waiver_decision_required') {
        setWaiverPrompt({ added: e.added || [] }); // open the system decision dialog
        return;
      }
      /* the body surfaces other errors inline */
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="כרטיסים לסיור קבוצתי"
      size="xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="text-sm text-gray-600 border border-gray-300 rounded-md px-4 py-2 hover:bg-gray-50">
            ביטול
          </button>
          <button onClick={() => saveAndClose()} disabled={saving} className="bg-emerald-600 text-white text-sm font-semibold rounded-md px-6 py-2 hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'שומר…' : 'שמור וסגור'}
          </button>
        </>
      }
    >
      <GroupTicketBuilder ref={builderRef} deal={deal} context={context} />
      {waiverPrompt && (
        <WaiverDecisionDialog
          added={waiverPrompt.added}
          busy={saving}
          onDecide={(decision) => saveAndClose(decision)}
          onCancel={() => setWaiverPrompt(null)}
        />
      )}
    </Dialog>
  );
}
