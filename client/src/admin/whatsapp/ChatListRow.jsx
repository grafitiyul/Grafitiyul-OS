import { useState } from 'react';
import Checks from './Checks.jsx';
import ActivityBadgeChip from '../deals/ActivityBadgeChip.jsx';
import PhoneFlag from './PhoneFlag.jsx';

// ONE conversation row — the shared list-row component for every WhatsApp
// conversation list (the inbox today; any future surface reuses this, so the
// unread/identity/selection language can never diverge).
//
// Visual hierarchy (WhatsApp-Desktop-like):
//   UNREAD → bold dark name, bold dark preview, emerald count bubble
//            (or an EMPTY emerald circle when manually marked unread with no
//            new messages), emerald bold time.
//   READ   → clearly lighter: regular gray name, light-gray preview.
//   SELECTED → 3px emerald accent line on the far right edge + soft tint.
// All identity text is right-aligned (text-right — dir=auto alone fixes bidi
// ordering, not alignment) so mixed Hebrew/English names share one edge.

function fmtWhen(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const same =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    return same
      ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  } catch {
    return '';
  }
}

function fmtSnoozedUntil(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function snippet(msg) {
  if (!msg) return 'אין הודעות';
  if (msg.textContent) return msg.textContent.slice(0, 60);
  return { image: '📷 תמונה', video: '🎬 סרטון', audio: '🎤 הודעה קולית', document: '📄 מסמך', sticker: 'סטיקר' }[msg.messageType] || 'הודעה';
}

// Snooze presets → a concrete Date.
function snoozeOptions() {
  const now = Date.now();
  const tomorrow9 = new Date();
  tomorrow9.setDate(tomorrow9.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  return [
    { label: 'לשעה', until: new Date(now + 3600_000) },
    { label: 'ל-3 שעות', until: new Date(now + 3 * 3600_000) },
    { label: 'עד מחר 9:00', until: tomorrow9 },
    { label: 'לשבוע', until: new Date(now + 7 * 86_400_000) },
  ];
}

// WhatsApp profile picture with a clean fallback. The URL was captured at
// ingest (WhatsApp CDN, signed + expiring) — the image lazy-loads, and any
// failure (expired URL, offline CDN) falls back to an initials avatar with a
// deterministic pastel per chat; unnamed numbers get a person glyph. Nothing
// here fetches synchronously — it's just an <img loading="lazy">.
const AVATAR_TONES = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-teal-100 text-teal-700',
];

function avatarTone(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

function initialsOf(chat) {
  const name = chat.displayName && chat.displayName !== chat.phoneNumber ? chat.displayName : '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('');
}

function Avatar({ chat }) {
  const [broken, setBroken] = useState(false);
  if (chat.profilePictureUrl && !broken) {
    return (
      <img
        src={chat.profilePictureUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-10 w-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  if (chat.type === 'group') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[17px]">
        👥
      </span>
    );
  }
  const initials = initialsOf(chat);
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
        initials ? avatarTone(chat.id) : 'bg-gray-100 text-gray-400'
      }`}
    >
      {initials || '👤'}
    </span>
  );
}

// Tiny icon button in the row's hover action cluster.
function RowAction({ onClick, title, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-[12px] text-gray-500 shadow-sm ring-1 ring-gray-200 hover:text-gray-800"
    >
      {children}
    </button>
  );
}

export default function ChatListRow({
  chat,
  active = false,
  cursor = false,
  unreadCount = 0,
  manualUnread = false,
  snoozeMenuOpen = false,
  onOpen,
  onTogglePin,
  onToggleRead,
  onToggleSnoozeMenu,
  onSnooze, // (isoString | null)
}) {
  const unreadN = unreadCount;
  const manualOnly = manualUnread && unreadN === 0;
  const unread = unreadN > 0 || manualOnly;
  const lastOut = chat.lastMessage?.direction === 'outgoing';
  const snoozed = chat.snoozedUntil && new Date(chat.snoozedUntil) > new Date();
  const isGroup = chat.type === 'group';
  const showPhone = !isGroup && chat.phoneNumber && chat.displayName !== chat.phoneNumber;

  return (
    <div
      role="button"
      tabIndex={0}
      data-chat-row={chat.id}
      onClick={() => onOpen(chat)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(chat)}
      className={`group relative cursor-pointer px-3 py-2.5 transition ${
        active ? 'bg-emerald-50/70' : cursor ? 'bg-gray-100' : 'hover:bg-gray-50'
      }`}
    >
      {/* Selected indicator — thin emerald accent on the far right edge. */}
      {active && <span className="absolute inset-y-0 right-0 w-[3px] bg-emerald-500" />}

      <div className="flex items-start gap-2.5">
        <Avatar chat={chat} />
        <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        {chat.pinnedAt && <span className="shrink-0 text-[11px] text-gray-400" title="שיחה נעוצה">📌</span>}
        {snoozed && (
          <span className="shrink-0 text-[11px]" title={`בנודניק עד ${fmtSnoozedUntil(chat.snoozedUntil)}`}>💤</span>
        )}
        <span
          className={`min-w-0 flex-1 truncate text-right text-[14px] ${
            unread ? 'font-bold text-gray-900' : 'font-normal text-gray-600'
          }`}
          dir="auto"
        >
          {chat.displayName || chat.phoneNumber || 'לא מזוהה'}
        </span>
        <span
          className={`shrink-0 text-[10.5px] ${unread ? 'font-bold text-emerald-600' : 'text-gray-400'}`}
          dir="ltr"
        >
          {fmtWhen(chat.lastMessageAt)}
        </span>
      </div>

      <div className="mt-0.5 flex items-center gap-1.5">
        {/* Direction: outgoing = delivery checks; incoming unread = bold. */}
        {lastOut && <Checks status={chat.lastMessage?.deliveryStatus || 'sent'} size={14} />}
        <span
          className={`min-w-0 flex-1 truncate text-right text-[12.5px] ${
            unread ? 'font-bold text-gray-900' : 'font-normal text-gray-400'
          }`}
          dir="auto"
        >
          {snippet(chat.lastMessage)}
        </span>
        {unreadN > 0 ? (
          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white shadow-sm">
            {unreadN > 99 ? '99+' : unreadN}
          </span>
        ) : manualOnly ? (
          // Manually marked unread, no new messages — an empty emerald
          // circle (WhatsApp Desktop behavior).
          <span
            className="h-3 w-3 shrink-0 rounded-full border-[2.5px] border-emerald-500"
            title="סומנה כלא נקראה"
          />
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {/* Phone — always visible, on the identity edge; foreign numbers
            carry a small country flag (Israeli numbers stay bare). */}
        {showPhone && (
          <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-gray-400" dir="ltr">
            <PhoneFlag phone={chat.phoneNumber} />
            {chat.phoneNumber}
          </span>
        )}
        {isGroup ? (
          // Groups carry NO CRM chips (no deal / contact / needs-attention) —
          // they are read/reply conversations, outside the CRM workflow.
          <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-500">
            👥 קבוצה
          </span>
        ) : chat.deal ? (
          // The EXACT Deal-header badge (shared resolver + shared tones).
          <ActivityBadgeChip
            activityType={chat.deal.activityType}
            orgTypeLabel={chat.deal.orgTypeLabel}
            subtypeLabel={chat.deal.subtypeLabel}
            title={chat.deal.title}
          />
        ) : chat.contact ? (
          <span className="min-w-0 truncate rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-500">
            {chat.contact.name || 'איש קשר'}
          </span>
        ) : (
          // Blue = "needs CRM attention".
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700 ring-1 ring-blue-200">
            ללא שיוך
          </span>
        )}
        {/* Hover action cluster — pin / read / snooze */}
        <div className="relative mr-auto hidden items-center gap-1 group-hover:flex">
          <RowAction
            title={chat.pinnedAt ? 'ביטול נעיצה' : 'נעיצת השיחה'}
            onClick={() => onTogglePin(chat)}
          >
            📌
          </RowAction>
          <RowAction
            title={unread ? 'סימון כנקראה' : 'סימון כלא נקראה'}
            onClick={() => onToggleRead(chat)}
          >
            {unread ? '✓' : '✉'}
          </RowAction>
          <RowAction
            title={snoozed ? 'נודניק פעיל' : 'נודניק (הסתרה זמנית)'}
            onClick={() => onToggleSnoozeMenu(chat)}
          >
            💤
          </RowAction>
        </div>
      </div>
        </div>
      </div>

      {snoozeMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSnoozeMenu(null);
            }}
          />
          <div
            className="absolute left-2 top-full z-40 -mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {snoozeOptions().map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => onSnooze(o.until.toISOString())}
                className="block w-full px-3 py-1.5 text-right text-[12.5px] text-gray-700 hover:bg-gray-50"
              >
                {o.label}
              </button>
            ))}
            {snoozed && (
              <button
                type="button"
                onClick={() => onSnooze(null)}
                className="block w-full border-t border-gray-100 px-3 py-1.5 text-right text-[12.5px] font-medium text-red-600 hover:bg-red-50"
              >
                ביטול הנודניק
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
