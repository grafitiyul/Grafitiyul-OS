import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import WhatsAppBodyEditor from '../communication/WhatsAppBodyEditor.jsx';
import { DateField, TimeField } from '../common/pickers/DateTimeFields.jsx';
import { toInstant } from '../email/ScheduleSendDialog.jsx';
import { StaffAvatar } from '../tours/TourTeamEditor.jsx';
import { registerDynamicFields } from '../../lib/dynamicFields.js';
import AccountBubbles from '../whatsapp/AccountBubbles.jsx';
import { WhatsAppPreviewBubble } from '../whatsapp/waPreview.jsx';
import StaffMessageHistory from './StaffMessageHistory.jsx';
import { resolveAccountId, readRememberedAccountId, rememberAccountId } from '../whatsapp/senderAccount.js';
import { htmlToWhatsApp } from '../../../../shared/waMarkup.mjs';
import { api } from '../../lib/api.js';
import { useFileDrop } from '../common/useFileDrop.js';

// שליחת וואטסאפ לצוות — bulk-personalized sends over the CANONICAL WhatsApp
// pipeline. This modal only prepares a batch: the server renders each
// recipient's own message and the shared scheduled-message worker sends with
// the global per-number pacing. Nothing here talks to the bridge.
//
// Reuses: WhatsAppBodyEditor (the Communication Center WhatsApp editor +
// variable chips + live bubble preview), the shared Date/Time pickers, the
// shared Dialog shell, and the roster the צוות screen already loaded.

const ERROR_HE = {
  unknown_account: 'המספר השולח שנבחר אינו זמין',
  account_required: 'יש לבחור מספר שולח',
  recipients_required: 'יש לבחור לפחות נמען אחד',
  no_valid_recipients: 'לא נמצא אף נמען עם מספר וואטסאפ תקין',
  scheduled_at_past: 'מועד השליחה חייב להיות לפחות דקה קדימה',
  scheduled_at_invalid: 'מועד השליחה אינו תקין',
  content_required: 'יש לכתוב הודעה או לצרף קובץ',
  unknown_tokens: 'ההודעה מכילה משתנים שאינם נתמכים',
  storage_not_configured: 'אחסון הקבצים אינו מוגדר — לא ניתן לצרף קבצים',
  media_invalid: 'הקובץ גדול מדי או אינו תקין (עד 16MB)',
  too_many_attachments: 'ניתן לצרף עד 10 קבצים',
};

const SKIP_REASON_HE = {
  missing_phone: 'אין מספר טלפון',
  invalid_phone: 'מספר הטלפון אינו תקין',
  duplicate_phone: 'מספר זהה לנמען אחר',
  not_eligible: 'אינו פעיל',
  not_found: 'לא נמצא',
  missing_variables: 'חסר ערך למשתנה',
};

const ROW_STATUS_HE = {
  pending: 'ממתין בתור',
  sending: 'נשלח כעת…',
  sent: 'נשלח',
  failed: 'נכשל',
  cancelled: 'בוטל',
  skipped: 'דולג',
};

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('read_failed'));
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.readAsDataURL(blob);
  });
}

const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const ATT_ICON = { image: '🖼️', video: '🎬', document: '📄' };

function pad(n) { return String(n).padStart(2, '0'); }
function defaultScheduleParts() {
  const d = new Date(Date.now() + 60 * 60_000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:00`,
  };
}

export default function StaffWhatsAppModal({ open, onClose, people, preselectedIds = null }) {
  const [meta, setMeta] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [recipientSearch, setRecipientSearch] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [timing, setTiming] = useState('now'); // 'now' | 'schedule'
  const [schedule, setSchedule] = useState(defaultScheduleParts);
  const [review, setReview] = useState(null);
  const [previewPersonId, setPreviewPersonId] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false); // two-step confirm for large sends
  const [result, setResult] = useState(null); // batch summary after submit
  const [historyOpen, setHistoryOpen] = useState(false);
  // Loading a previous message must REPLACE the editor's document. TipTap only
  // accepts an external value while unfocused, so remount it deliberately.
  const [editorNonce, setEditorNonce] = useState(0);
  const idemKeyRef = useRef(null);

  // The roster this modal offers: active, non-former staff (the same "active
  // roster" default the list screen shows). Eligibility truth stays server-side.
  const eligible = useMemo(
    () => (people || [])
      .filter((p) => p.status === 'active' && p.lifecycleHint !== 'former')
      .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'he')),
    [people],
  );

  // Reset per open + mint the batch idempotency key for THIS user action.
  useEffect(() => {
    if (!open) return;
    idemKeyRef.current = (crypto.randomUUID?.() || `k${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setSelected(new Set(
      (preselectedIds || []).filter((id) => eligible.some((p) => p.id === id)),
    ));
    setRecipientSearch('');
    setResult(null);
    setError(null);
    setArmed(false);
    setReview(null);
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Meta: sender accounts + staff variables (registered so chips show labels).
  useEffect(() => {
    if (!open || meta) return;
    api.whatsapp.staffSend.meta()
      .then((m) => {
        setMeta(m);
        registerDynamicFields((m.variables || []).map((v) => ({ key: v.key, label: v.labelHe, description: v.descriptionHe })));
        // Same resolution order as every other WhatsApp surface: this
        // browser's remembered number first, then the first usable one.
        setAccountId((prev) => prev || resolveAccountId(m.accounts || [], { remembered: readRememberedAccountId() }) || '');
      })
      .catch((e) => setError(e.message));
  }, [open, meta]);

  const selectedIds = useMemo(() => [...selected], [selected]);

  // Server-side review — the truth about phones/duplicates/missing variables.
  useEffect(() => {
    if (!open || selectedIds.length === 0) { setReview(null); return undefined; }
    const t = setTimeout(() => {
      api.whatsapp.staffSend.review({ mode: 'selected', personRefIds: selectedIds, bodyHtml })
        .then(setReview)
        .catch(() => setReview(null));
    }, 500);
    return () => clearTimeout(t);
  }, [open, selectedIds, bodyHtml]);

  const validRecipients = useMemo(
    () => (review?.recipients || []).filter((r) => r.state === 'valid'),
    [review],
  );
  const problemRecipients = useMemo(
    () => (review?.recipients || []).filter((r) => r.state !== 'valid'),
    [review],
  );

  // Resolution for the ONE preview. The server renders it with the same
  // resolver the send uses, so the preview is the message — not an imitation.
  // `sourceText` stamps WHICH text it was rendered from, so a result that
  // arrives after the operator kept typing is recognised as stale instead of
  // being shown as if it were current.
  useEffect(() => {
    if (!open) return undefined;
    const target = previewPersonId && validRecipients.some((r) => r.personRefId === previewPersonId)
      ? previewPersonId
      : validRecipients[0]?.personRefId;
    const sourceText = htmlToWhatsApp(bodyHtml).trim();
    if (!target || !sourceText) { setPreview(null); return undefined; }
    const t = setTimeout(() => {
      api.whatsapp.staffSend.preview({ bodyHtml, personRefId: target })
        .then((p) => setPreview({ ...p, personRefId: target, sourceText }))
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [open, bodyHtml, previewPersonId, validRecipients]);

  // Poll the batch after a send-now submit so the operator sees the queue drain.
  useEffect(() => {
    if (!result?.batch?.id || !result.batch.sendNow) return undefined;
    const hasLive = result.rows?.some((r) => ['pending', 'sending'].includes(r.status));
    if (!hasLive) return undefined;
    const t = setTimeout(() => {
      api.whatsapp.staffSend.batch(result.batch.id).then(setResult).catch(() => {});
    }, 5000);
    return () => clearTimeout(t);
  }, [result]);

  const toggleRecipient = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setArmed(false);
  }, []);

  async function attachFiles(files) {
    const list = [...files].slice(0, 10 - attachments.length);
    if (!list.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        if (!file.size || file.size > MAX_ATTACHMENT_BYTES) {
          setError(`"${file.name}" גדול מ־16MB ולא צורף`);
          continue;
        }
        const dataBase64 = await blobToBase64(file);
        const ref = await api.whatsapp.staffSend.uploadAttachment({
          fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64,
        });
        setAttachments((prev) => [...prev, ref]);
      }
    } catch (e) {
      setError(ERROR_HE[e.message] || `העלאת הקובץ נכשלה: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  // Click OR drag files onto the attachments section — same attachFiles path
  // (any file kind, like the picker; per-file size/count rules live there).
  const attachDrop = useFileDrop({
    accept: '*',
    multiple: true,
    onFiles: attachFiles,
    disabled: uploading || attachments.length >= 10 || meta?.storageConfigured === false,
  });

  async function submit() {
    const n = validRecipients.length;
    if (!n || busy) return;
    if (n >= 10 && !armed) { setArmed(true); return; }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        idempotencyKey: idemKeyRef.current,
        accountId,
        mode: 'selected',
        personRefIds: selectedIds,
        bodyHtml,
        attachments,
        sendNow: timing === 'now',
      };
      if (timing === 'schedule') {
        const at = toInstant(schedule.date, schedule.time);
        if (!at || at.getTime() < Date.now() + 60_000) {
          setError(ERROR_HE.scheduled_at_past);
          setBusy(false);
          return;
        }
        payload.scheduledAt = at.toISOString();
      }
      const summary = await api.whatsapp.staffSend.createBatch(payload);
      setResult(summary);
    } catch (e) {
      setError(ERROR_HE[e.message] || `השליחה נכשלה: ${e.message}`);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  const accounts = meta?.accounts || [];
  const gapSeconds = meta?.gapSeconds || 20;
  // TipTap's empty document is '<p></p>' — emptiness is judged on the
  // serialized WhatsApp text, the same form the server sends.
  const bodyText = useMemo(() => htmlToWhatsApp(bodyHtml).trim(), [bodyHtml]);
  const n = validRecipients.length;
  const estimateMin = n > 1 ? Math.ceil((n * gapSeconds) / 60) : 0;
  const filteredEligible = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter((p) => [p.displayName, p.phone, p.email, p.team?.displayName]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [eligible, recipientSearch]);

  const scheduledInstant = timing === 'schedule' ? toInstant(schedule.date, schedule.time) : null;
  const primaryLabel = busy
    ? 'שולח…'
    : armed
      ? `לאשר שליחה ל־${n} אנשי צוות?`
      : timing === 'now'
        ? (n === 1 ? 'שלח עכשיו לאיש צוות אחד' : `שלח עכשיו ל־${n} אנשי צוות`)
        : (n === 1 ? 'תזמן לאיש צוות אחד' : `תזמן ל־${n} אנשי צוות`);

  // ── The ONE preview's inputs ──────────────────────────────────────────────
  // Which recipient it is resolved for: the operator's pick while it is still
  // a valid recipient, else the first valid one.
  const previewTargetId = previewPersonId && validRecipients.some((r) => r.personRefId === previewPersonId)
    ? previewPersonId
    : validRecipients[0]?.personRefId || '';
  // The resolved copy is only usable when it belongs to THAT recipient AND was
  // rendered from the CURRENT text — otherwise the preview would confidently
  // show a stale message, which is worse than showing the template.
  const resolvedForTarget =
    preview && preview.personRefId === previewTargetId && preview.sourceText === bodyText ? preview : null;
  const previewMarkup = resolvedForTarget ? resolvedForTarget.text : bodyText;
  const previewPending = !!previewTargetId && !resolvedForTarget && !!bodyText;

  // ── Result view — the honest batch summary ────────────────────────────────
  if (result) {
    const counts = result.counts || {};
    const skipped = result.batch?.skipped || [];
    return (
      <Dialog open={open} onClose={onClose} title="שליחת וואטסאפ לצוות" size="lg">
        <div dir="rtl" className="space-y-4">
          {result.replay && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              הבקשה כבר בוצעה — מוצגת השליחה הקיימת (לא נוצרה שליחה כפולה).
            </div>
          )}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-900">
            {result.batch.sendNow
              ? `${result.batch.recipientCount} הודעות נכנסו לתור השליחה`
              : `${result.batch.recipientCount} הודעות תוזמנו ל־${new Date(result.batch.scheduledAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
            {skipped.length > 0 && ` · ${skipped.length} נמענים דולגו`}
            {result.batch.sendNow && n > 1 && (
              <div className="mt-1 text-[12px] text-emerald-700">
                ההודעות יוצאות בזו אחר זו במרווח של כ־{gapSeconds} שניות בין הודעות מאותו מספר.
              </div>
            )}
          </div>
          {skipped.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="mb-1.5 text-[13px] font-semibold text-amber-900">נמענים שדולגו</div>
              <ul className="space-y-1 text-[12.5px] text-amber-800">
                {skipped.map((s) => (
                  <li key={s.personRefId}>
                    {s.name || s.personRefId} — {SKIP_REASON_HE[s.reason] || s.reason}
                    {s.detail ? ` (${s.detail})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-200">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-gray-100">
                {(result.rows || []).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.name || r.destinationPhone}</td>
                    <td className="px-3 py-2 text-gray-500" dir="ltr">{r.destinationPhone}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                        r.status === 'sent' ? 'bg-emerald-100 text-emerald-800'
                          : r.status === 'failed' ? 'bg-red-100 text-red-700'
                            : r.status === 'sending' ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-600'
                      }`}
                      >
                        {ROW_STATUS_HE[r.status] || r.status}
                      </span>
                      {r.failureReason && <span className="ms-2 text-[11px] text-red-500">{r.failureReason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setResult(null); idemKeyRef.current = crypto.randomUUID?.() || `k${Date.now()}`; }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              שליחה נוספת
            </button>
            <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              סגירה
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  // ── Compose view ──────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onClose={onClose} title="שליחת וואטסאפ לצוות" size="2xl" contentClassName="flex-1 overflow-y-auto p-4">
      <div dir="rtl" className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── Right column (RTL leading): sender + recipients ── */}
        <div className="space-y-4">
          <section>
            <div className="mb-1.5 text-[13px] font-semibold text-gray-800">מספר שולח</div>
            {/* The canonical picker. `alwaysShow` because choosing the sending
                number is half of what this screen is for — unlike a
                conversation panel, it must be stated even with one number. */}
            <AccountBubbles
              accounts={accounts}
              activeId={accountId}
              label={null}
              alwaysShow
              onSelect={(id) => {
                setAccountId(id);
                rememberAccountId(id);
              }}
            />
            {accountId && accounts.find((a) => a.id === accountId)?.phone && (
              <p className="mt-1.5 text-[11.5px] text-gray-500" dir="ltr">
                +{accounts.find((a) => a.id === accountId).phone}
              </p>
            )}
            {meta && accounts.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                אין מספרי וואטסאפ מחוברים.
              </div>
            )}
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-gray-800">נמענים</span>
              <span className="text-[12px] text-gray-500">{selected.size} נבחרו</span>
            </div>
            <input
              type="search"
              value={recipientSearch}
              onChange={(e) => setRecipientSearch(e.target.value)}
              placeholder="חיפוש איש צוות…"
              className="mb-1.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-[13px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <div className="mb-1.5 flex gap-2 text-[12px]">
              <button
                type="button"
                onClick={() => { setSelected(new Set(filteredEligible.map((p) => p.id))); setArmed(false); }}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50"
              >
                בחירת כולם ({filteredEligible.length})
              </button>
              <button
                type="button"
                onClick={() => { setSelected(new Set()); setArmed(false); }}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-50"
              >
                ניקוי
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white">
              {filteredEligible.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2.5 border-b border-gray-50 px-3 py-1.5 text-[13px] last:border-b-0 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleRecipient(p.id)}
                    className="accent-blue-600"
                  />
                  <StaffAvatar src={p.profile?.imageUrl} name={p.displayName} className="h-6 w-6" />
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{p.displayName}</span>
                  <span className="shrink-0 text-[11.5px] text-gray-400" dir="ltr">{p.phone || '—'}</span>
                </label>
              ))}
              {filteredEligible.length === 0 && (
                <div className="px-3 py-4 text-center text-[12.5px] text-gray-400">לא נמצאו אנשי צוות</div>
              )}
            </div>

            {/* Server review — phones, duplicates, missing variables. */}
            {review && problemRecipients.length > 0 && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
                <div className="mb-1 text-[12.5px] font-semibold text-amber-900">
                  {problemRecipients.length} נמענים לא ייכללו בשליחה
                </div>
                <ul className="space-y-0.5 text-[12px] text-amber-800">
                  {problemRecipients.map((r) => (
                    <li key={r.personRefId} className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate">
                        {r.name || r.personRefId} — {SKIP_REASON_HE[r.state] || r.state}
                        {r.duplicateOf ? ` (כמו ${r.duplicateOf})` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleRecipient(r.personRefId)}
                        className="shrink-0 text-[11px] text-amber-600 underline hover:text-amber-900"
                      >
                        הסרה
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {review && review.counts?.missingVariables > 0 && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-[12px] text-amber-800">
                אצל {review.counts.missingVariables} נמענים חסר ערך לאחד המשתנים שבהודעה — הם ידולגו.
                {' '}
                {(review.recipients || [])
                  .filter((r) => r.state === 'valid' && r.missingVariables?.length)
                  .slice(0, 5)
                  .map((r) => `${r.name} (${r.missingVariables.join(', ')})`)
                  .join(' · ')}
              </div>
            )}
          </section>
        </div>

        {/* ── Left column: message + attachments + timing + submit ── */}
        <div className="space-y-4">
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-gray-800">הודעה</span>
              {/* Start from something already sent, rather than from a blank
                  page — the record of real sends IS the history. */}
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50"
              >
                🕘 היסטוריית הודעות
              </button>
            </div>
            <WhatsAppBodyEditor
              key={editorNonce}
              value={bodyHtml}
              onChange={(html) => { setBodyHtml(html); setArmed(false); }}
              variables={meta?.variables || []}
              categories={meta?.categories || {}}
              showVariableKeys={false}
              // ONE preview on this screen, and it lives below with the
              // recipient selector — the editor's own would be a second one
              // showing the same message with variables unresolved.
              showPreview={false}
            />
            <div className="mt-1 text-[11.5px] text-gray-400">
              המשתנים מוחלפים בנפרד עבור כל נמען — כל איש צוות מקבל הודעה אישית משלו.
            </div>
          </section>

          {/* THE preview — one, canonical, and exactly what WhatsApp will send.
              It renders the RESOLVED markup for a chosen recipient through the
              shared bubble, so it is simultaneously visually accurate (bold,
              lists, links, emojis, spacing) and factually accurate (real
              values). Until a recipient is chosen it shows the same message in
              its template state, with variables as chips — the same renderer,
              never a second preview disagreeing with this one. */}
          <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-gray-700">כך תיראה ההודעה אצל</span>
              <select
                value={previewTargetId}
                onChange={(e) => setPreviewPersonId(e.target.value)}
                aria-label="נמען לתצוגה מקדימה"
                className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-[12.5px]"
              >
                {validRecipients.length === 0 && <option value="">— בחרו נמען —</option>}
                {validRecipients.map((r) => (
                  <option key={r.personRefId} value={r.personRefId}>{r.name}</option>
                ))}
              </select>
              {previewPending && <span className="text-[11.5px] text-gray-400">מרכיב…</span>}
            </div>
            <WhatsAppPreviewBubble
              markup={previewMarkup}
              attachments={attachments}
              emptyText="כתבו הודעה כדי לראות אותה כאן…"
            />
            {!resolvedForTarget && bodyText && (
              <div className="mt-1.5 text-[12px] text-gray-500">
                {validRecipients.length === 0
                  ? 'בחרו נמענים כדי לראות את ההודעה עם הערכים האמיתיים — בינתיים המשתנים מוצגים כשמות.'
                  : 'מרכיב את הנוסח עבור הנמען שנבחר…'}
              </div>
            )}
            {resolvedForTarget?.missingVariables?.length > 0 && (
              <div className="mt-1.5 text-[12px] text-amber-700">
                חסר ערך אצל נמען זה: {resolvedForTarget.missingVariables.join(', ')} — נמען זה ידולג.
              </div>
            )}
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-gray-800">קבצים מצורפים</span>
              <span className="text-[11.5px] text-gray-400">עד 10 קבצים · 16MB לקובץ</span>
            </div>
            <div
              className={`space-y-1.5 rounded-lg transition ${attachDrop.dragOver ? 'bg-blue-50 ring-2 ring-blue-300' : ''}`}
              {...attachDrop.dropProps}
            >
              {attachments.map((a, i) => (
                <div key={a.key} className="flex items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px]">
                  <span>{ATT_ICON[a.kind] || '📄'}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{a.fileName}</span>
                  {a.sizeBytes && <span className="text-[11px] text-gray-400">{fmtSize(a.sizeBytes)}</span>}
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500"
                    aria-label="הסרת קובץ"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <input {...attachDrop.inputProps} />
              <button
                type="button"
                disabled={uploading || attachments.length >= 10 || meta?.storageConfigured === false}
                onClick={attachDrop.open}
                className={`rounded-lg border border-dashed px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50 ${
                  attachDrop.dragOver
                    ? 'border-blue-400 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                {uploading ? 'מעלה…' : attachDrop.dragOver ? 'שחררו כאן' : '📎 צירוף קבצים — לחיצה או גרירה'}
              </button>
              {meta?.storageConfigured === false && (
                <div className="text-[11.5px] text-amber-700">{ERROR_HE.storage_not_configured}</div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-1.5 text-[13px] font-semibold text-gray-800">מועד שליחה</div>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`cursor-pointer rounded-xl border px-3 py-1.5 text-[13px] font-medium ${timing === 'now' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600'}`}>
                <input type="radio" name="staff-wa-timing" className="sr-only" checked={timing === 'now'} onChange={() => setTiming('now')} />
                שליחה מיידית
              </label>
              <label className={`cursor-pointer rounded-xl border px-3 py-1.5 text-[13px] font-medium ${timing === 'schedule' ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-600'}`}>
                <input type="radio" name="staff-wa-timing" className="sr-only" checked={timing === 'schedule'} onChange={() => setTiming('schedule')} />
                🕓 תזמון
              </label>
              {timing === 'schedule' && (
                <div className="flex items-center gap-2">
                  <DateField value={schedule.date} onChange={(v) => setSchedule((s) => ({ ...s, date: v }))} clearable={false} />
                  <TimeField value={schedule.time} onChange={(v) => setSchedule((s) => ({ ...s, time: v }))} clearable={false} />
                </div>
              )}
            </div>
            {timing === 'schedule' && scheduledInstant && (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12.5px] text-blue-800">
                יישלח ב־{scheduledInstant.toLocaleString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </section>

          {/* Send summary + primary action */}
          <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
            <div className="text-[12.5px] leading-relaxed text-gray-600">
              {accountId && accounts.find((a) => a.id === accountId) && (
                <>נשלח מ־<b>{accounts.find((a) => a.id === accountId)?.label}</b> · </>
              )}
              <b>{n}</b> נמענים
              {attachments.length > 0 && <> · {attachments.length} קבצים</>}
              {n > 1 && (
                <>
                  {' '}· ההודעות יוצאות בזו אחר זו במרווח של כ־{gapSeconds} שניות
                  {estimateMin > 0 && ` (כ־${estimateMin} דקות בסך הכל)`}
                </>
              )}
            </div>
            {error && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12.5px] text-red-700">{error}</div>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                ביטול
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || !accountId || n === 0 || (!bodyText && attachments.length === 0) || uploading}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${armed ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              >
                {primaryLabel}
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Start from a previous message. It lands in the editor as an ordinary
          draft — chips intact, fully editable — and nothing is sent until the
          operator sends it. Attachments are deliberately NOT carried over:
          their R2 objects belong to that send, and silently re-attaching files
          the operator did not choose is not "start from". */}
      <StaffMessageHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        accounts={accounts}
        onPick={(batch) => {
          setBodyHtml(batch.templateHtml || '');
          setEditorNonce((n) => n + 1);
          setArmed(false);
          setPreview(null);
          setHistoryOpen(false);
        }}
      />
    </Dialog>
  );
}
