import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import QuestionnaireFillDialog from '../../questionnaire/QuestionnaireFillDialog.jsx';
import FormActionButton from '../../questionnaire/FormActionButton.jsx';

// "טופס שיחת תיאום" — the per-Booking coordination form action inside the
// tour modal's customer card. Every Booking gets its OWN independent form
// (group tours included).
//
// INTERNAL operational questionnaire (product decision): the operator fills
// it during the coordination call, in the SAME staff fill dialog Tour Summary
// uses. No customer links, no copy/send, no intermediate popup — the button
// opens the questionnaire directly.

export default function CoordinationFormAction({ bookingId }) {
  const [status, setStatus] = useState(null); // null | draft | submitted | reviewed
  const [fillOpen, setFillOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const list = await api.questionnaires.listSubmissions({
        subjectType: 'booking',
        subjectId: bookingId,
        purpose: 'coordination',
      });
      const active = list.find((s) => ['draft', 'submitted', 'reviewed'].includes(s.status));
      setStatus(active?.status || null);
    } catch {
      setStatus(null);
    }
  }, [bookingId]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return (
    <>
      {/* A REAL button (shared FormActionButton) — lives in the customer
          card's top row, same visual as the Guide Portal action. */}
      <FormActionButton label="טופס שיחת תיאום" status={status} onClick={() => setFillOpen(true)} />

      <QuestionnaireFillDialog
        open={fillOpen}
        onClose={() => {
          setFillOpen(false);
          refreshStatus();
        }}
        purpose="coordination"
        subjectType="booking"
        subjectId={bookingId}
        title="טופס שיחת תיאום"
        onStatusChange={() => refreshStatus()}
      />
    </>
  );
}
