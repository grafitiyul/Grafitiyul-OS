import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import WhyPanel from './WhyPanel.jsx';
import { PROPOSAL_STATUS, CONFIDENCE_LABELS, fmtDateTime } from './config.js';

// ONE proposal, rendered identically in the Review screen and inside a WhatsApp
// conversation. Shared on purpose: a suggestion that behaves differently in two
// places is two features, and the operator has to learn both.
//
// Interaction contract (§2 of the spec):
//   • Send / Edit / Reject, all visible without hunting.
//   • Editing happens INLINE — no modal, no context switch.
//   • Closing or collapsing the card executes nothing. The only writes are the
//     explicit "שלח" and "דחה" buttons.
//   • Ctrl/⌘+Enter sends, Esc leaves edit mode — a keyboard-efficient loop for
//     an operator working through a queue.
//   • A stale proposal renders its reason and CANNOT be sent.
export default function ProposalCard({ proposal, compact = false, onHandled = null }) {
  const [text, setText] = useState(proposal?.proposedText || '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showWhy, setShowWhy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const textareaRef = useRef(null);

  // Seed from the record ID, never from the object: a harmless refetch must not
  // wipe a half-written edit (the drafts-survive-refetch rule).
  useEffect(() => {
    setText(proposal?.proposedText || '');
    setEditing(false);
    setRejecting(false);
    setError(null);
  }, [proposal?.id]);

  if (!proposal) return null;

  const status = PROPOSAL_STATUS[proposal.status] || { label: proposal.status, style: 'bg-gray-100 text-gray-600' };
  const stale = proposal.staleness?.stale;
  const isShadow = proposal.status === 'shadow';
  const actionable = proposal.status === 'open' && !stale;
  const run = proposal.run || {};
  const edited = text.trim() !== (proposal.proposedText || '').trim();

  async function send() {
    if (!actionable || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.aiAgent.proposalSend(proposal.id, edited ? text : null);
      onHandled?.('sent');
    } catch (e) {
      setError(e?.payload?.message || e?.payload?.error || 'השליחה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.aiAgent.proposalReject(proposal.id, rejectReason.trim() || null);
      onHandled?.('rejected');
    } catch (e) {
      setError(e?.payload?.error || 'הדחייה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setEditing(false); setText(proposal.proposedText || ''); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  }

  return (
    <div className={`rounded-xl border bg-white ${stale ? 'border-gray-200 opacity-90' : 'border-blue-200'} ${compact ? 'p-3' : 'p-4'}`}>
      {/* ── Header: what this is, and its state ─────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[12px] font-semibold text-blue-800">
          🤖 {run.intent || run.capabilityKey || 'הצעת תשובה'}
        </span>
        <span className={`rounded-md px-2 py-0.5 text-[12px] ${status.style}`}>{status.label}</span>
        {run.confidence && (
          <span className="gos-meta">{CONFIDENCE_LABELS[run.confidence] || run.confidence}</span>
        )}
        {run.dealId && !compact && <span className="gos-meta">דיל #{proposal.run?.contextPack?.deal?.orderNo ?? '—'}</span>}
        <span className="gos-meta ms-auto">{fmtDateTime(proposal.createdAt)}</span>
      </div>

      {/* ── The two states that must never be mistaken for "ready to send" ── */}
      {isShadow && (
        <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
          <strong>מצב צל.</strong> זו רק רשומה של מה שהסוכן היה עונה — היא לא נשלחת ולא מוצעת לשליחה.
        </div>
      )}
      {stale && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          <strong>ההצעה כבר לא רלוונטית.</strong> {proposal.staleReasonHe || 'ההקשר השתנה מאז שנוצרה.'} לא ניתן לשלוח אותה.
        </div>
      )}
      {run.escalate && (
        <div className="mb-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-[13px] text-orange-900">
          <strong>דורש אדם.</strong> {run.escalationReason || 'הסוכן לא בטוח מספיק כדי להציע תשובה לשליחה.'}
        </div>
      )}

      {/* ── The draft ──────────────────────────────────────────────────── */}
      {editing ? (
        <textarea
          ref={textareaRef}
          dir="auto"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={Math.min(12, Math.max(4, text.split('\n').length + 1))}
          className="w-full rounded-lg border border-blue-300 bg-white p-3 text-[14px] leading-relaxed text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      ) : (
        <div
          dir="auto"
          className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-[14px] leading-relaxed text-gray-900"
        >
          {proposal.proposedText || <span className="gos-meta">אין טיוטה</span>}
        </div>
      )}

      {proposal.finalText && proposal.finalText !== proposal.proposedText && (
        <div className="mt-2">
          <div className="gos-meta mb-1">מה נשלח בפועל</div>
          <div dir="auto" className="whitespace-pre-wrap rounded-lg bg-emerald-50 p-3 text-[14px] leading-relaxed text-emerald-900">
            {proposal.finalText}
          </div>
        </div>
      )}

      {/* ── Proposed ACTIONS: what will happen, why, what changes ───────── */}
      {proposal.actions?.length > 0 && (
        <div className="mt-3 space-y-2">
          {proposal.actions.map((a) => (
            <ActionPreview key={a.toolKey} action={a} proposalId={proposal.id} disabled={!actionable || busy} onDone={onHandled} />
          ))}
        </div>
      )}

      {error && <div className="mt-2 rounded bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</div>}

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {actionable && !rejecting && (
          <>
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'שולח…' : edited ? 'שלח את הגרסה שלי' : 'שלח'}
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing((v) => !v)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700 transition hover:bg-gray-50"
            >
              {editing ? 'סיים עריכה' : 'ערוך'}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700 transition hover:bg-gray-50"
            >
              דחה
            </button>
          </>
        )}

        {rejecting && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <input
              dir="auto"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="למה זה לא מתאים? (לא חובה — עוזר ללמידה)"
              className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-[13px]"
            />
            <button
              type="button"
              onClick={reject}
              disabled={busy}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              אשר דחייה
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700"
            >
              ביטול
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowWhy((v) => !v)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] text-gray-700 transition hover:bg-gray-50"
        >
          {showWhy ? 'סגור' : 'למה?'}
        </button>
        {actionable && (
          <span className="gos-meta ms-auto hidden sm:inline">Ctrl+Enter לשליחה</span>
        )}
      </div>

      {showWhy && <div className="mt-3"><WhyPanel run={run} /></div>}
    </div>
  );
}

// An ACTION is not a message: it changes GOS data. It therefore states plainly
// what will happen and what will change BEFORE the operator can approve it.
function ActionPreview({ action, proposalId, disabled, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.aiAgent.proposalAction(proposalId, action.toolKey, action.input || {});
      onDone?.('action');
    } catch (e) {
      setError(e?.payload?.message || e?.payload?.error || 'הפעולה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
      <div className="gos-detail mb-1 font-semibold text-purple-900">
        פעולה מוצעת: {action.labelHe}
      </div>
      <div className="gos-detail mb-1 text-purple-900">{action.whatHappens}</div>
      {action.whatChanges?.length > 0 && (
        <ul className="mb-2 space-y-0.5">
          {action.whatChanges.map((c, i) => (
            <li key={i} className="gos-meta text-purple-800">• {c}</li>
          ))}
        </ul>
      )}
      {error && <div className="mb-2 text-[13px] text-rose-700">{error}</div>}
      {action.implemented ? (
        <button
          type="button"
          onClick={run}
          disabled={disabled || busy}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy ? 'מבצע…' : 'אשר וביצע'}
        </button>
      ) : (
        <div className="gos-meta">הפעולה הזו עדיין לא ממומשת — היא מוצגת כדי שתדע מה הסוכן זיהה.</div>
      )}
    </div>
  );
}
