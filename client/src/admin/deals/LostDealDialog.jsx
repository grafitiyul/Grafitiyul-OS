import { useEffect, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import { useDirtyWhen } from '../../lib/dirtyForms.js';

// In-system LOST flow — replaces the old window.prompt. A required reason is
// chosen from the shared LostReason catalog; notes are optional, multi-line and
// resizable. Save stays disabled until a reason is selected.
//
// onSubmit receives STRUCTURED data: { lostReasonId, lostNotes }. The Deal model
// stores these as proper columns (lostReasonId FK + lostNotes) — no more
// "reason — notes" free-text packing.
export default function LostDealDialog({ open, onClose, onSubmit }) {
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reasonId, setReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReasonId('');
    setNotes('');
    setLoading(true);
    api.lostReasons
      .list()
      .then((list) => setReasons((list || []).filter((r) => r.active)))
      .catch(() => setReasons([]))
      .finally(() => setLoading(false));
  }, [open]);

  // Unsaved-work guard (auto-update): dirty once a reason/notes are entered;
  // clears on revert, submit, or close.
  useDirtyWhen({ reasonId, notes }, { reasonId: '', notes: '' }, { active: open });

  async function submit() {
    if (!reasonId) return;
    const trimmedNotes = notes.trim();
    setSaving(true);
    try {
      await onSubmit({ lostReasonId: reasonId, lostNotes: trimmedNotes || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      title="סימון הדיל ל-LOST"
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100 disabled:opacity-50"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!reasonId || saving}
            className="text-sm bg-red-600 text-white rounded px-4 py-1.5 font-medium hover:bg-red-700 disabled:opacity-40"
          >
            {saving ? 'שומר…' : 'סמן כ-LOST'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            סיבת LOST <span className="text-red-600">*</span>
          </label>
          {loading ? (
            <div className="text-sm text-gray-400">טוען סיבות…</div>
          ) : reasons.length ? (
            <select
              value={reasonId}
              onChange={(e) => setReasonId(e.target.value)}
              className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
            >
              <option value="">— בחרו סיבה —</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameHe}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-gray-500">
              לא הוגדרו סיבות LOST. ניתן להגדיר אותן בהגדרות ה-CRM.
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">
            הערות LOST <span className="text-gray-400 font-normal">(אופציונלי)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="פרטים נוספים על סיבת ה-LOST…"
            className="w-full min-h-[88px] max-h-[40vh] resize-y overflow-y-auto rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
          />
        </div>
      </div>
    </Dialog>
  );
}
