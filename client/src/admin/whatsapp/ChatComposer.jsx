import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';

// Text composer at the bottom of a chat thread (Slice 6). Enter sends,
// Shift+Enter breaks a line — WhatsApp muscle memory. Each logical message
// gets a clientKey (UUID); pressing send again after a failure reuses the
// SAME key, so the server/bridge idempotency replays instead of
// double-messaging the customer. Editing the text mints a new key.

const SEND_ERRORS = {
  whatsapp_not_connected: 'המספר שלנו לא מחובר כרגע — בדקו את חיבור ה-WhatsApp בהגדרות.',
  whatsapp_number_not_found: 'המספר הזה לא רשום ב-WhatsApp.',
  send_timeout: 'השליחה נתקעה — החיבור מתאושש, נסו שוב בעוד רגע.',
  on_whatsapp_timeout: 'השליחה נתקעה — נסו שוב בעוד רגע.',
  bridge_unreachable: 'שירות ה-WhatsApp לא זמין כרגע.',
  bridge_not_configured: 'שירות ה-WhatsApp לא הוגדר עדיין למספר הזה.',
};

function quotedPreviewText(msg) {
  if (!msg) return '';
  if (msg.textContent) return msg.textContent.slice(0, 120);
  const label = { image: 'תמונה', video: 'סרטון', audio: 'הודעה קולית', document: 'מסמך', sticker: 'סטיקר' }[msg.messageType];
  return label || 'הודעה';
}

// datetime-local default: round up to the next full hour.
function nextHourLocal() {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ChatComposer({ chat, replyTo, onCancelReply, onSent, onScheduled }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const keyRef = useRef({ key: null, fingerprint: null });
  const textareaRef = useRef(null);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    // Same text + same reply target ⇒ same idempotency key across retries.
    const fingerprint = `${body}|${replyTo?.id || ''}`;
    if (keyRef.current.fingerprint !== fingerprint) {
      keyRef.current = { key: crypto.randomUUID(), fingerprint };
    }
    setSending(true);
    setError(null);
    try {
      const resp = await api.whatsapp.sendMessage(chat.id, {
        text: body,
        quotedMessageId: replyTo?.id || null,
        clientKey: keyRef.current.key,
      });
      keyRef.current = { key: null, fingerprint: null };
      setText('');
      onCancelReply?.();
      onSent?.(resp.message || null);
    } catch (e) {
      setError(SEND_ERRORS[e?.payload?.error] || 'השליחה נכשלה — נסו שוב.');
    } finally {
      setSending(false);
    }
  }

  async function schedule() {
    const body = text.trim();
    if (!body || sending || !scheduleAt) return;
    const when = new Date(scheduleAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
      setError('בחרו מועד עתידי (לפחות דקה קדימה).');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.whatsapp.scheduleMessage(chat.id, { text: body, scheduledAt: when.toISOString() });
      setText('');
      setScheduleOpen(false);
      onCancelReply?.();
      onScheduled?.();
    } catch (e) {
      setError(
        e?.payload?.error === 'scheduled_at_past'
          ? 'המועד שנבחר כבר עבר — בחרו מועד עתידי.'
          : 'קביעת התזמון נכשלה — נסו שוב.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      {replyTo && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5">
          <div className="min-w-0 flex-1 rounded-lg border-r-4 border-emerald-500 bg-gray-50 px-2.5 py-1.5">
            <p className="text-[11px] font-semibold text-emerald-700">
              {replyTo.direction === 'outgoing' ? 'אני' : replyTo.senderName || replyTo.senderPhone || 'תגובה להודעה'}
            </p>
            <p className="truncate text-[12px] text-gray-600" dir="auto">
              {quotedPreviewText(replyTo)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="ביטול תגובה"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ×
          </button>
        </div>
      )}
      {error && (
        <p className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-700">{error}</p>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={sending}
          onChange={(e) => {
            setText(e.target.value);
            // auto-grow up to ~5 lines
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="כתבו הודעה…"
          dir="auto"
          className="min-h-[38px] flex-1 resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-[14px] leading-snug focus:border-emerald-500 focus:outline-none disabled:opacity-60"
        />
        <button
          type="button"
          title="תזמון שליחה"
          disabled={sending}
          onClick={() => {
            setScheduleOpen(!scheduleOpen);
            if (!scheduleAt) setScheduleAt(nextHourLocal());
            if (!scheduleOpen) textareaRef.current?.focus();
          }}
          className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border text-[16px] transition disabled:opacity-40 ${
            scheduleOpen ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500 hover:text-gray-700'
          }`}
        >
          🕓
        </button>
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="h-[38px] shrink-0 rounded-xl bg-emerald-600 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
        >
          {sending ? 'שולח…' : 'שליחה'}
        </button>
      </div>
      {scheduleOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-blue-50/60 px-3 py-2">
          {!text.trim() && (
            <p className="w-full text-[12px] text-blue-800">
              כתבו את ההודעה בשדה למעלה, בחרו מועד — והיא תישלח אוטומטית.
            </p>
          )}
          <span className="text-[12px] font-medium text-gray-700">שליחה בתאריך:</span>
          <input
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-[13px]"
          />
          <button
            type="button"
            onClick={schedule}
            disabled={sending || !text.trim() || !scheduleAt}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {sending ? 'קובע…' : 'תזמון ההודעה'}
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(false)}
            className="text-[12px] text-gray-500 hover:text-gray-700"
          >
            ביטול
          </button>
        </div>
      )}
    </div>
  );
}
