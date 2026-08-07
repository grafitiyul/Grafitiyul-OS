import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { emitDealTasksChanged } from '../deals/tasks/taskEvents.js';
import { readDrafts, writeDraft, draftKeyFor } from './drafts.js';
import { isDraftChat, materializeChat, START_ERRORS } from './chatTarget.js';
import { announceWhatsappMessageSent } from './composerEvents.js';
import { formatPhoneDisplay } from '../../lib/phone.js';
import EmojiPickerPanel from '../../lib/EmojiPickerPanel.jsx';

// Text composer at the bottom of a chat thread (Slice 6). Enter sends,
// Shift+Enter breaks a line — WhatsApp muscle memory. Each logical message
// gets a clientKey (UUID); pressing send again after a failure reuses the
// SAME key, so the server/bridge idempotency replays instead of
// double-messaging the customer. Editing the text mints a new key.
//
// `chat` may be a DRAFT TARGET (chatTarget.js) — a contact × one of our numbers
// with no conversation row yet. The composer behaves identically; the row is
// created by the first successful action and handed back via `onMaterialized`.

const SEND_ERRORS = {
  // Creating the conversation is part of sending the first message, so its
  // failures are send failures and read in the same voice.
  ...START_ERRORS,
  whatsapp_not_connected: 'המספר שלנו לא מחובר כרגע — בדקו את חיבור ה-WhatsApp בהגדרות.',
  whatsapp_number_not_found: 'המספר הזה לא רשום ב-WhatsApp.',
  send_timeout: 'השליחה נתקעה — החיבור מתאושש, נסו שוב בעוד רגע.',
  on_whatsapp_timeout: 'השליחה נתקעה — נסו שוב בעוד רגע.',
  bridge_unreachable: 'שירות ה-WhatsApp לא זמין כרגע.',
  bridge_not_configured: 'שירות ה-WhatsApp לא הוגדר עדיין למספר הזה.',
  voice_transcode_failed: 'עיבוד ההקלטה נכשל בשרת — ההודעה לא נשלחה (הקלטות דורשות רכיב המרה בשרת).',
  media_too_large: 'הקובץ גדול מדי — ניתן לשלוח עד 16MB.',
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

// Emoji picking is EmojiPickerPanel — the one shared catalog (bundled dataset,
// Hebrew i18n, search / categories / skin tones / frequently-used), also used by
// the rich-text toolbars and by message reactions. This file owns only where the
// popup sits and what happens to the chosen character.
function EmojiPicker({ onPick, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute bottom-[52px] right-0 z-30 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
        <EmojiPickerPanel onPick={onPick} width={320} height={300} />
      </div>
    </>
  );
}

function fmtRecSeconds(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// WebM/Opus FIRST — the battle-tested MediaRecorder path in Chromium. Some
// Chromium builds claim ogg support but emit broken (silent) files, which was
// exactly the "voice message has no sound" bug: the bad source poisoned the
// preview, the WhatsApp send AND the stored copy. Ogg stays last-resort
// (Firefox records it natively and correctly); the bridge re-encodes
// EVERYTHING through ffmpeg regardless.
const REC_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MAX_REC_SECONDS = 300;

function fmtKb(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(blob);
  });
}

// Draft persistence lives in ./drafts.js (shared) — closing the panel must
// never eat a half-written message, and any feature can seed a draft there and
// open the composer. Scoped by accountId+chatId; sending (or emptying the text)
// clears the entry.

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

// Touch keyboards: Enter must insert a NEWLINE, never send — there is no
// Shift+Enter on a phone, and accidental sends are worse than an extra tap on
// the send button. Evaluated once (a device's primary pointer doesn't change).
const COARSE_POINTER =
  typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

function classifyFile(file) {
  if (file.type?.startsWith('image/')) return 'image';
  if (file.type?.startsWith('video/')) return 'video';
  return 'document';
}

// `seed` / `onTextChange` / `persistDraft` are GENERIC composer controls, not
// feature-specific hooks: any surface that wants to hand the composer a starting
// text (e.g. the Deal WhatsApp-template modal) passes `seed={{ text, nonce }}`
// and bumps the nonce to replace the text. `persistDraft={false}` opts a
// short-lived embedded composer out of the shared chat draft store, so it can
// neither read nor clobber the draft of a composer mounted elsewhere on the
// same chat. `fill` makes the composer a flex column that FILLS its container —
// the text area grows to the available height instead of the thread's 200px
// auto-grow cap (used when the composer is the main surface of a tall modal
// rather than a strip under a message list). `enterSends={false}` turns Enter
// back into a plain newline and leaves the שליחה BUTTON as the only way to send —
// for surfaces that are a message EDITOR rather than a chat input, where an
// accidental keystroke must never reach a customer. Defaults keep the normal
// thread composer behaving exactly as before (Enter sends, WhatsApp muscle
// memory).
export default function ChatComposer({ chat, replyTo, onCancelReply, onSent, onScheduled, onMaterialized = null, dealId = null, droppedFiles = null, onDroppedFilesConsumed, seed = null, onTextChange = null, persistDraft = true, fill = false, enterSends = true }) {
  const draftKey = draftKeyFor(chat);
  const [text, setText] = useState(() => (persistDraft ? readDrafts()[draftKey] || '' : seed?.text || ''));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Voice recording: null | {phase:'recording',seconds} | {phase:'preview',blob,url,seconds,key}
  const [rec, setRec] = useState(null);
  // Live input level while recording (0..1) — the on-screen proof the mic is
  // actually being heard; a flat meter = capture problem, named immediately.
  const [recLevel, setRecLevel] = useState(0);
  // Pending attachments (multi): [{ file, kind, url (image preview), key }]
  const [attachments, setAttachments] = useState([]);
  const keyRef = useRef({ key: null, fingerprint: null });
  const textareaRef = useRef(null);
  const recorderRef = useRef(null);
  const recTimerRef = useRef(null);
  const meterRef = useRef({ ctx: null, timer: null });
  const maxLevelRef = useRef(0);
  const fileInputRef = useRef(null);

  // The conversation this composer acts on — CREATING it first when this is a
  // draft target (a number the contact has never been written to from). This is
  // the ONE place in the client where a conversation comes into existence, and
  // it happens at the moment of a real action, never on viewing. `announce`
  // runs only after the action succeeded, so the surrounding surface swaps to
  // the real chat with the message already on its way.
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const materializedRef = useRef(null);

  async function liveChat() {
    const current = chatRef.current;
    if (!isDraftChat(current)) return current;
    const real = await materializeChat(current);
    materializedRef.current = real;
    return real;
  }

  function announceMaterialized() {
    const created = materializedRef.current;
    if (!created) return;
    materializedRef.current = null;
    onMaterialized?.(created);
  }

  // The ONE exit every successful send takes. Besides telling this composer's
  // own parent, it broadcasts the sent message to the whole app — a chat can be
  // open in the thread, the dock and the "תבנית ווטסאפ" modal at the same time,
  // and only the composer that happened to send used to know about it. Merging
  // is by message id, so the bridge's later sync of the same message replaces
  // this row instead of adding a second one.
  function announceSent(liveChat, message) {
    announceMaterialized();
    onSent?.(message);
    announceWhatsappMessageSent({ chatId: liveChat?.id || null, message });
  }

  // Draft persistence is opt-out (see the props note above).
  const saveDraft = useCallback(
    (value) => {
      if (persistDraft) writeDraft(draftKey, value);
    },
    [persistDraft, draftKey],
  );

  // Externally seeded text (template modal). Keyed on the nonce so re-selecting
  // the SAME template/language still re-seeds, and so a seed can never fight
  // with the user's typing between seeds.
  const seedNonce = seed?.nonce ?? null;
  useEffect(() => {
    if (seedNonce == null) return;
    setText(seed?.text || '');
    // A new text is a new logical message — mint a fresh idempotency key.
    keyRef.current = { key: null, fingerprint: null };
  }, [seedNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report the live text so an embedding surface can tell an edited draft from
  // an untouched one (e.g. "replace the draft?" confirmation).
  useEffect(() => {
    onTextChange?.(text);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  function attachFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (files.length === 0) return;
    setError(null);
    const accepted = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${file.name || 'קובץ'}" גדול מדי — ניתן לשלוח עד 16MB.`);
        continue;
      }
      if (file.size < 10) continue; // empty
      const kind = classifyFile(file);
      accepted.push({
        file,
        kind,
        url: kind === 'image' ? URL.createObjectURL(file) : null,
        // One idempotency key per attachment — retry-safe.
        key: crypto.randomUUID(),
      });
    }
    if (accepted.length) setAttachments((cur) => [...cur, ...accepted].slice(0, 10));
  }

  function removeAttachment(key) {
    setAttachments((cur) => {
      const item = cur.find((a) => a.key === key);
      if (item?.url) URL.revokeObjectURL(item.url);
      return cur.filter((a) => a.key !== key);
    });
  }

  // Files dropped anywhere on the thread arrive via prop.
  useEffect(() => {
    if (droppedFiles?.length) {
      attachFiles(droppedFiles);
      onDroppedFilesConsumed?.();
    }
  }, [droppedFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Send the attachment queue sequentially. The composer text rides as the
  // caption of the FIRST file. Files that made it out are removed from the
  // queue as they go, so a mid-batch failure retries only the remainder —
  // each item keeps its own idempotency key across retries.
  async function sendAttachments() {
    if (attachments.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const queue = [...attachments];
    let firstOut = true;
    let lastMessage = null;
    try {
      const live = await liveChat();
      for (const item of queue) {
        const mediaBase64 = await blobToBase64(item.file);
        const resp = await api.whatsapp.sendMedia(live.id, {
          mediaBase64,
          mimeType: item.file.type || 'application/octet-stream',
          fileName: item.file.name || '',
          kind: item.kind,
          caption: firstOut ? text.trim() : '',
          clientKey: item.key,
        });
        firstOut = false;
        lastMessage = resp.message || lastMessage;
        removeAttachment(item.key);
      }
      setText('');
      saveDraft('');
      onCancelReply?.();
      announceSent(live, lastMessage);
    } catch (e) {
      setError(
        e?.payload?.error === 'media_too_large'
          ? 'הקובץ גדול מדי — ניתן לשלוח עד 16MB.'
          : SEND_ERRORS[e?.payload?.error] || 'שליחת הקובץ נכשלה — הקבצים שנותרו לא נשלחו, נסו שוב.',
      );
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  // Persist the draft while typing (debounced), and FLUSH on unmount so
  // closing the panel mid-word never loses the tail.
  const textForDraftRef = useRef(text);
  textForDraftRef.current = text;
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  useEffect(() => {
    const t = setTimeout(() => saveDraft(text), 250);
    return () => clearTimeout(t);
  }, [saveDraft, text]);
  useEffect(() => () => saveDraftRef.current(textForDraftRef.current), [draftKey]);

  // A restored multi-line draft needs its height computed once on mount. In
  // `fill` mode the height is CSS-driven (flex), so inline sizing must not run —
  // it would pin the field to the text's height and stop it filling the modal.
  useEffect(() => {
    if (fill) return;
    const el = textareaRef.current;
    if (el && el.value) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [fill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Teardown on unmount: stop any live recording + release blob URLs
  // (recording preview + attachment image previews).
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(
    () => () => {
      try {
        recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
        recorderRef.current?.stop?.();
      } catch { /* already stopped */ }
      clearInterval(recTimerRef.current);
      for (const a of attachmentsRef.current) if (a.url) URL.revokeObjectURL(a.url);
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
    // Live level meter (WebAudio analyser on the same stream) — if this stays
    // flat while speaking, the capture itself is silent (wrong input device).
    maxLevelRef.current = 0;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) {
          const d = Math.abs(v - 128);
          if (d > peak) peak = d;
        }
        const level = peak / 128;
        if (level > maxLevelRef.current) maxLevelRef.current = level;
        setRecLevel(level);
      }, 120);
      meterRef.current = { ctx, timer };
    } catch {
      meterRef.current = { ctx: null, timer: null };
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimerRef.current);
      clearInterval(meterRef.current.timer);
      meterRef.current.ctx?.close?.().catch?.(() => undefined);
      setRecLevel(0);
      setRec((cur) => {
        if (!cur || cur.phase !== 'recording' || cur.cancelled) return null;
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
        if (blob.size < 200) return null; // accidental tap
        return {
          phase: 'preview',
          blob,
          url: URL.createObjectURL(blob),
          seconds: cur.seconds,
          maxLevel: maxLevelRef.current,
          // One idempotency key per RECORDING — a retry of the same clip
          // replays instead of double-sending.
          key: crypto.randomUUID(),
        };
      });
    };
    recorderRef.current = recorder;
    // Timeslice: deliver chunks every 250ms during recording instead of one
    // flush on stop — immune to platforms that lose the final flush.
    recorder.start(250);
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
      const live = await liveChat();
      const resp = await api.whatsapp.sendVoice(live.id, {
        audioBase64,
        mimeType: rec.blob.type,
        seconds: rec.seconds,
        clientKey: rec.key,
      });
      URL.revokeObjectURL(rec.url);
      setRec(null);
      announceSent(live, resp.message || null);
    } catch (e) {
      setError(SEND_ERRORS[e?.payload?.error] || 'שליחת ההקלטה נכשלה — נסו שוב.');
    } finally {
      setSending(false);
    }
  }

  async function send() {
    if (attachments.length) return sendAttachments();
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
      const live = await liveChat();
      const resp = await api.whatsapp.sendMessage(live.id, {
        text: body,
        quotedMessageId: replyTo?.id || null,
        clientKey: keyRef.current.key,
      });
      keyRef.current = { key: null, fingerprint: null };
      setText('');
      saveDraft('');
      onCancelReply?.();
      announceSent(live, resp.message || null);
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
      // In a Deal context the backend also creates a linked WhatsApp Task; send
      // the user's LOCAL wall-clock date/time (the picker is local) alongside the
      // tz-correct ISO instant so the task's due fields read correctly.
      // Scheduling to a number with no conversation yet CREATES the
      // conversation now (pending, empty) so the queued message has a real
      // thread to land in — when its time comes it simply becomes the first
      // message, exactly like sending one by hand.
      const live = await liveChat();
      await api.whatsapp.scheduleMessage(live.id, {
        text: body,
        scheduledAt: when.toISOString(),
        ...(dealId
          ? { dealId, dueDate: String(scheduleAt).slice(0, 10), dueTime: String(scheduleAt).slice(11, 16) }
          : {}),
      });
      setText('');
      saveDraft('');
      setScheduleOpen(false);
      onCancelReply?.();
      announceMaterialized();
      onScheduled?.();
      // Deal focus area shows the new open Task immediately (no page refresh).
      if (dealId) emitDealTasksChanged(dealId);
    } catch (e) {
      setError(
        e?.payload?.error === 'scheduled_at_past'
          ? 'המועד שנבחר כבר עבר — בחרו מועד עתידי.'
          : SEND_ERRORS[e?.payload?.error] || 'קביעת התזמון נכשלה — נסו שוב.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`border-t border-gray-200 bg-gray-50 ${fill ? 'flex h-full min-h-0 flex-col' : ''}`}>
      {replyTo && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-1.5">
          <div className="min-w-0 flex-1 rounded-lg border-r-4 border-emerald-500 bg-gray-50 px-2.5 py-1.5">
            <p className="text-[11px] font-semibold text-emerald-700">
              {replyTo.direction === 'outgoing' ? 'אני' : replyTo.senderName || formatPhoneDisplay(replyTo.senderPhone) || 'תגובה להודעה'}
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
          {/* Live input level — flat while speaking = the mic isn't heard. */}
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200" title="עוצמת קליטה">
            <span
              className="block h-full rounded-full bg-emerald-500 transition-[width] duration-100"
              style={{ width: `${Math.min(100, Math.round(recLevel * 160))}%` }}
            />
          </span>
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
          {rec.maxLevel !== undefined && rec.maxLevel < 0.03 && (
            <p className="w-full rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800">
              ⚠️ כמעט לא נקלט קול בהקלטה — ייתכן שנבחר מיקרופון שגוי בהגדרות המערכת/הדפדפן.
            </p>
          )}
          <audio controls src={rec.url} className="h-10 min-w-0 flex-1" />
          <span dir="ltr" className="font-mono text-[12px] text-gray-500">
            {fmtRecSeconds(rec.seconds)} · {fmtKb(rec.blob.size)}
          </span>
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
        // Two rows: the text field gets the FULL width (long Hebrew wraps
        // comfortably, grows up to ~8 lines), actions live on their own row
        // beneath — nothing squeezes the text. Dropping a file anywhere here
        // attaches them (the thread area forwards drops via droppedFiles).
        <div
          className={`relative px-3 pb-2 pt-2 ${fill ? 'flex min-h-0 flex-1 flex-col' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            attachFiles(e.dataTransfer?.files);
          }}
        >
          {attachments.length > 0 && (
            <div className="mb-1.5 rounded-xl border border-emerald-200 bg-emerald-50/50 px-2.5 py-2">
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div
                    key={a.key}
                    className="relative flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5"
                  >
                    {a.url ? (
                      <img src={a.url} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="text-xl leading-none">{a.kind === 'video' ? '🎬' : '📄'}</span>
                    )}
                    <div className="min-w-0 max-w-[150px]">
                      <p className="truncate text-[12px] font-medium text-gray-800" dir="ltr">
                        {a.file.name || 'קובץ'}
                      </p>
                      <p className="text-[10.5px] text-gray-500">{fmtKb(a.file.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.key)}
                      aria-label="הסרת הקובץ"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[15px] text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                {attachments.length === 1 ? 'קובץ אחד יישלח' : `${attachments.length} קבצים יישלחו`}
                {text.trim() ? ' — הכיתוב שלמטה יצורף לקובץ הראשון' : ''}
              </p>
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            disabled={sending}
            onChange={(e) => {
              setText(e.target.value);
              // auto-grow, capped so the thread stays visible. In `fill` mode the
              // field already occupies the available height — leave it to CSS.
              if (fill) return;
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              // Editor surfaces (enterSends={false}): NO keystroke sends. Enter
              // and Shift+Enter both fall through to the textarea's native
              // newline; the שליחה button is the only send path. Touch devices
              // always fall through too (see COARSE_POINTER).
              if (!enterSends || COARSE_POINTER) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                // In schedule mode the ONLY primary action is scheduling —
                // Enter must never send immediately.
                if (scheduleOpen) schedule();
                else send();
              }
            }}
            onPaste={(e) => {
              // Ctrl+V with an image (or files) on the clipboard attaches it —
              // screenshots paste straight into the conversation.
              const files = [...(e.clipboardData?.files || [])];
              if (files.length) {
                e.preventDefault();
                attachFiles(files);
              }
            }}
            placeholder={attachments.length ? 'כיתוב לקובץ הראשון (לא חובה)…' : 'כתבו הודעה…'}
            dir="auto"
            // `fill` surfaces are read/edit-heavy (long stored templates), so the
            // text runs 1px larger there than in the thread's compact strip.
            // Below md the font is 16px — iOS Safari auto-zooms into any
            // focused field smaller than that, wrecking the chat layout.
            className={`block w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2.5 leading-relaxed focus:border-emerald-500 focus:outline-none disabled:opacity-60 ${
              fill
                ? 'min-h-0 flex-1 overflow-y-auto text-[16px] md:text-[15px]'
                : 'min-h-[42px] text-[16px] md:text-[14px]'
            }`}
          />
          <div className={`mt-1.5 flex items-center gap-1.5 ${fill ? 'shrink-0' : ''}`}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                attachFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              title="צירוף קובץ"
              disabled={sending}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-[16px] text-gray-500 transition hover:text-gray-700 disabled:opacity-40 md:h-9 md:w-9"
            >
              📎
            </button>
            <button
              type="button"
              title="אימוג'י"
              disabled={sending}
              onClick={() => setEmojiOpen(!emojiOpen)}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[17px] transition disabled:opacity-40 md:h-9 md:w-9 ${
                emojiOpen ? 'border-amber-400 bg-amber-50' : 'border-gray-300 bg-white text-gray-500 hover:text-gray-700'
              }`}
            >
              😊
            </button>
            <button
              type="button"
              title="הקלטת הודעה קולית"
              disabled={sending}
              onClick={startRecording}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-300 bg-white text-[16px] text-gray-500 transition hover:text-gray-700 disabled:opacity-40 md:h-9 md:w-9"
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
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[16px] transition disabled:opacity-40 md:h-9 md:w-9 ${
                scheduleOpen ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-500 hover:text-gray-700'
              }`}
            >
              🕓
            </button>
            {/* In schedule mode the primary action becomes "תזמן הודעה" and the
                normal immediate-send action is gone entirely — so a user who
                opened scheduling can't accidentally send now. */}
            {scheduleOpen ? (
              <button
                type="button"
                onClick={schedule}
                disabled={sending || !text.trim() || !scheduleAt}
                className="mr-auto h-10 shrink-0 rounded-xl bg-blue-600 px-5 text-[13px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40 md:h-9"
              >
                {sending ? 'קובע…' : 'תזמן הודעה'}
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={sending || (!text.trim() && attachments.length === 0)}
                className="mr-auto h-10 shrink-0 rounded-xl bg-emerald-600 px-5 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40 md:h-9"
              >
                {sending
                  ? 'שולח…'
                  : attachments.length > 1
                    ? `שליחת ${attachments.length} קבצים`
                    : attachments.length === 1
                      ? 'שליחת קובץ'
                      : 'שליחה'}
              </button>
            )}
          </div>
          {emojiOpen && (
            <EmojiPicker onPick={(e) => insertEmoji(e)} onClose={() => setEmojiOpen(false)} />
          )}
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
          {/* The schedule action lives on the primary button above (which
              replaced "שליחה"); this only exits schedule mode. */}
          <button
            type="button"
            onClick={() => setScheduleOpen(false)}
            className="text-[12px] text-gray-500 hover:text-gray-700"
          >
            ביטול תזמון
          </button>
        </div>
      )}
    </div>
  );
}
