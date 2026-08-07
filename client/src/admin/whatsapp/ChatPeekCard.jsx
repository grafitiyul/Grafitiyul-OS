import { useEffect, useState } from 'react';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import Checks from './Checks.jsx';
import { peekChat } from './chatPeek.js';
import { waPlainText } from './waFormat.js';
import { waTextNodes } from './WaText.jsx';
import { whatsAppSecondaryName } from './chatIdentity.js';
import { formatPhoneDisplay } from '../../lib/phone.js';

// The desktop equivalent of WhatsApp-iPhone's long-press peek: read the tail of
// a conversation without entering it.
//
// It is READ-ONLY by construction — it renders what peekChat() fetched from the
// pure-read messages endpoint and does nothing else. No selection change, no
// read receipt, no contact/deal linking, no write of any kind. Closing it is
// just closing it.
//
// Positioning delegates to AnchoredMenu (portal on <body>, fixed, flip +
// viewport clamp), so the card is never clipped by the list's scroll container
// — the same engine HoverCard uses. `overlay={false}` keeps the page live so
// the pointer can travel into the card and the row underneath still clicks.

const MEDIA_LABEL = {
  image: '🖼️ תמונה',
  video: '🎬 סרטון',
  audio: '🎤 הודעה קולית',
  document: '📄 מסמך',
  sticker: '😊 סטיקר',
};

function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    return sameDay
      ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function PeekRow({ m, showSender }) {
  const outbound = m.direction === 'outgoing';
  const media = m.media || m.messageType !== 'text' ? MEDIA_LABEL[m.messageType] : null;
  return (
    <div className={`flex ${outbound ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
          outbound ? 'rounded-tl-sm bg-[#d9fdd3] text-gray-900' : 'rounded-tr-sm bg-white text-gray-900 ring-1 ring-gray-200'
        }`}
      >
        {showSender && !outbound && (
          <p className="mb-0.5 text-[11px] font-semibold text-emerald-700" dir="auto">
            {m.senderName || formatPhoneDisplay(m.senderPhone) || 'משתתף לא מזוהה'}
          </p>
        )}
        {media && <p className="text-[12px] text-gray-500">{media}</p>}
        {m.textContent && (
          <p className="whitespace-pre-wrap break-words" dir="auto">
            {waTextNodes(m.textContent)}
          </p>
        )}
        <p className={`mt-0.5 flex items-center gap-1 text-[10px] text-gray-400 ${outbound ? 'justify-start' : 'justify-end'}`} dir="ltr">
          {outbound && <Checks status={m.deliveryStatus || 'sent'} size={12} />}
          <span>{fmtTime(m.timestampFromSource)}</span>
        </p>
      </div>
    </div>
  );
}

export default function ChatPeekCard({ anchorRef, chat, open, onClose, onMouseEnter, onMouseLeave }) {
  const [messages, setMessages] = useState(null);

  useEffect(() => {
    if (!open || !chat?.id) return undefined;
    let alive = true;
    peekChat(chat.id).then((rows) => {
      if (alive) setMessages(rows);
    });
    return () => {
      alive = false;
    };
  }, [open, chat?.id]);

  if (!open || !chat) return null;

  const waName = whatsAppSecondaryName(chat);
  const isGroup = chat.type === 'group';
  const unread = chat.unreadCount ?? 0;

  // The last thing WE said, and everything that came in after it — the two
  // things an operator wants before deciding whether to open the conversation.
  const lastOutIdx = messages ? messages.map((m) => m.direction).lastIndexOf('outgoing') : -1;
  const since = messages && lastOutIdx >= 0 ? messages.length - 1 - lastOutIdx : null;

  return (
    <AnchoredMenu
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      width={340}
      align="start"
      overlay={false}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      panelClassName="rounded-xl p-0"
    >
      {/* Same identity treatment as the list row: the CRM name leads, the
          WhatsApp name follows after a bare "~". One rule, so the card and the
          row it came from never describe the same person differently. */}
      <div className="border-b border-gray-100 px-3 py-2">
        <p
          data-identity="cluster"
          className="flex items-baseline justify-end gap-1.5 truncate text-right"
          dir="auto"
        >
          <span className="min-w-0 shrink truncate text-[13px] font-semibold text-gray-900">
            {chat.displayName || formatPhoneDisplay(chat.phoneNumber) || 'לא מזוהה'}
          </span>
          {waName && (
            <>
              <span className="shrink-0 text-[11px] text-gray-300" aria-hidden>
                ~
              </span>
              <span className="min-w-0 shrink truncate text-[11.5px] font-normal text-gray-400">
                {waName}
              </span>
            </>
          )}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-gray-400">
          {!isGroup && chat.phoneNumber && <span dir="ltr">{formatPhoneDisplay(chat.phoneNumber)}</span>}
          {isGroup && <span>👥 קבוצה</span>}
        </div>
      </div>

      <div className="max-h-[300px] space-y-1.5 overflow-y-auto bg-[#efe7dd] px-2.5 py-2">
        {messages === null ? (
          <p className="py-6 text-center text-[12px] text-gray-500">טוען…</p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-gray-500">אין הודעות בשיחה</p>
        ) : (
          messages.map((m) => <PeekRow key={m.id} m={m} showSender={isGroup} />)
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-1.5 text-[10.5px] text-gray-500">
        <span>
          {unread > 0
            ? `${unread} הודעות שלא נקראו`
            : since
              ? `${since} הודעות מאז התשובה שלנו`
              : 'עודכן'}
        </span>
        <span className="text-gray-400">קריאה בלבד — לחיצה תפתח את השיחה</span>
      </div>
    </AnchoredMenu>
  );
}

// Exported for the row's one-line summary of the peek (kept here so the peek's
// notion of "what this conversation says" has one home).
export const peekSnippet = (m) => (m?.textContent ? waPlainText(m.textContent) : '');
