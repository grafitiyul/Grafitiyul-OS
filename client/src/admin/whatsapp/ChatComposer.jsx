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

// Curated emoji set (no external picker dependency) — the ones people
// actually send in business chats, WhatsApp-ish ordering.
const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😍','🥰','😘','😋',
  '😎','🤩','🥳','😏','😌','😴','🤔','🤨','😐','😬','🙄','😮','😲','🥺','😢','😭',
  '😤','😡','🤯','😱','😳','🤗','🤭','🤫','🤝','🙏','👍','👎','👌','✌️','🤞','💪',
  '👏','🙌','👋','🤙','☝️','👆','👇','👈','👉','✋','❤️','🧡','💛','💚','💙','💜',
  '🖤','🤍','💔','❣️','💕','💖','💯','✨','🌟','⭐','🔥','🎉','🎊','🎈','🎁','🏆',
  '✅','❌','⚠️','❓','❗','💡','📌','📍','📅','🕐','⏰','📞','📱','💬','✉️','📷',
  '🚌','🚐','🚶','🏃','🗺️','🧭','🎨','🖼️','🏙️','🌆','🌃','🌇','☀️','🌧️','⛱️','🍕',
  '☕','🍺','🥤','🍦','💰','💳','🧾','📝','🤦','🤷','😜','😛','🫶','👀','🎯','🚀',
];

function EmojiPicker({ onPick, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute bottom-[46px] left-0 z-30 max-h-56 w-72 max-w-[85vw] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
        <div dir="ltr" className="grid grid-cols-8 gap-0.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[20px] leading-none hover:bg-gray-100"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function fmtRecSeconds(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const REC_MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const MAX_REC_SECONDS = 300;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(blob);
  });
}

export default function ChatComposer({ chat, replyTo, onCancelReply, onSent, onScheduled }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Voice recording: null | {phase:'recording',seconds} | {phase:'preview',blob,url,seconds,key}
  const [rec, setRec] = useState(null);
  const keyRef = useRef({ key: null, fingerprint: null });
  const textareaRef = useRef(null);
  const recorderRef = useRef(null);
  const recTimerRef = useRef(null);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Teardown on unmount: stop any live recording + release the blob URL.
  useEffect(
    () => () => {
      try {
        recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
        recorderRef.current?.stop?.();
      } catch { /* already stopped */ }
      clearInterval(recTimerRef.current);
    },
    [],
  );

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + emoji.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('הדפדפן הזה לא תומך בהקלטת קול.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'אין הרשאת מיקרופון — אפשרו גישה למיקרופון בהגדרות הדפדפן ונסו שוב.'
          : e?.name === 'NotFoundError'
            ? 'לא נמצא מיקרופון במחשב הזה.'
            : 'פתיחת המיקרופון נכשלה — נסו שוב.',
      );
      return;
    }
    const mime = REC_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimerRef.current);
      setRec((cur) => {
        if (!cur || cur.phase !== 'recording' || cur.cancelled) return null;
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
        if (blob.size < 200) return null; // accidental tap
        return {
          phase: 'preview',
          blob,
          url: URL.createObjectURL(blob),
          seconds: cur.seconds,
          // One idempotency key per RECORDING — a retry of the same clip
          // replays instead of double-sending.
          key: crypto.randomUUID(),
        };
      });
    };
    recorderRef.current = recorder;
    recorder.start();
    setRec({ phase: 'recording', seconds: 0 });
    recTimerRef.current = setInterval(() => {
      setRec((cur) => {
        if (!cur || cur.phase !== 'recording') return cur;
        if (cur.seconds + 1 >= MAX_REC_SECONDS) {
          try { recorder.stop(); } catch { /* already stopped */ }
          return { ...cur, seconds: cur.seconds + 1 };
        }
        return { ...cur, seconds: cur.seconds + 1 };
      });
    }, 1000);
  }

  function stopRecording() {
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
  }

  function cancelRecording() {
    setRec((cur) => {
      if (cur?.url) URL.revokeObjectURL(cur.url);
      if (cur?.phase === 'recording') {
        // flag so onstop discards the clip
        try { recorderRef.current?.stop(); } catch { /* already stopped */ }
        return { ...cur, cancelled: true };
      }
      return null;
    });
    // recording-phase cancel resolves to null in onstop; preview cancel now:
    setTimeout(() => setRec((cur) => (cur?.cancelled ? null : cur)), 0);
  }

  async function sendVoice() {
    if (!rec || rec.phase !== 'preview' || sending) return;
    setSending(true);
    setError(null);
    try {
      const audioBase64 = await blobToBase64(rec.blob);
      const resp = await api.whatsapp.sendVoice(chat.id, {
        audioBase64,
        mimeType: rec.blob.type,
        seconds: rec.seconds,
        clientKey: rec.key,
      });
      URL.revokeObjectURL(rec.url);
      setRec(null);
      onSent?.(resp.message || null);
    } catch (e) {
      setError(SEND_ERRORS[e?.payload?.error] || 'שליחת ההקלטה נכשלה — נסו שוב.');
    } finally {
      setSending(false);
    }
  }

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
      {/* Recording / preview replace the input row — one thing at a time. */}
      {rec?.phase === 'recording' && !rec.cancelled ? (
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-red-600">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            מקליט…
          </span>
          <span dir="ltr" className="font-mono text-[13px] text-gray-600">{fmtRecSeconds(rec.seconds)}</span>
          <div className="mr-auto flex items-center gap-2">
            <button
              type="button"
              onClick={cancelRecording}
              className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-xl bg-red-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700"
            >
              ■ עצירה
            </button>
          </div>
        </div>
      ) : rec?.phase === 'preview' ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <audio controls src={rec.url} className="h-10 min-w-0 flex-1" />
          <span dir="ltr" className="font-mono text-[12px] text-gray-500">{fmtRecSeconds(rec.seconds)}</span>
          <button
            type="button"
            disabled={sending}
            onClick={cancelRecording}
            title="מחיקת ההקלטה"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-gray-300 bg-white text-[16px] text-gray-500 hover:text-red-600 disabled:opacity-40"
          >
            🗑
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={sendVoice}
            className="h-[38px] rounded-xl bg-emerald-600 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
          >
            {sending ? 'שולח…' : 'שליחת הקלטה'}
          </button>
        </div>
      ) : (
        <div className="relative flex items-end gap-2 px-3 py-2">
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
            title="אימוג'י"
            disabled={sending}
            onClick={() => setEmojiOpen(!emojiOpen)}
            className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border text-[17px] transition disabled:opacity-40 ${
              emojiOpen ? 'border-amber-400 bg-amber-50' : 'border-gray-300 bg-white text-gray-500 hover:text-gray-700'
            }`}
          >
            😊
          </button>
          {emojiOpen && (
            <EmojiPicker
              onPick={(e) => insertEmoji(e)}
              onClose={() => setEmojiOpen(false)}
            />
          )}
          <button
            type="button"
            title="הקלטת הודעה קולית"
            disabled={sending}
            onClick={startRecording}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-[16px] text-gray-500 transition hover:text-gray-700 disabled:opacity-40"
          >
            🎙️
          </button>
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
      )}
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
