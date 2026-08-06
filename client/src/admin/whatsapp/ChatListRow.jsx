import { useRef, useState } from 'react';
import Checks from './Checks.jsx';
import ActivityBadgeChip from '../deals/ActivityBadgeChip.jsx';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import PhoneFlag from './PhoneFlag.jsx';
import { formatPhoneDisplay } from '../../lib/phone.js';
import { CHAT_ROW_ACCENT, chatRowClass } from './chatSelection.js';

// ONE conversation row — the shared list-row component for every WhatsApp
// conversation list (the inbox today; any future surface reuses this, so the
// unread/identity/selection language can never diverge).
//
// Visual hierarchy (WhatsApp-Desktop-like):
//   UNREAD → bold dark name, bold dark preview, emerald count bubble
//            (or an EMPTY emerald circle when manually marked unread with no
//            new messages), emerald bold time.
//   READ   → clearly lighter: regular gray name, light-gray preview.
//   SELECTED → soft semi-transparent BLUE fill + blue inset ring + a 3px blue
//            accent line on the far right edge (the open conversation must be
//            recognisable at a glance, and stay so while hovered). The state
//            itself lives in chatSelection.js — one definition for every list.
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
function RowAction({ onClick, title, children, btnRef = null }) {
  return (
    <button
      ref={btnRef}
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

const MENU_ITEM = 'block w-full px-3 py-2 text-right text-[13px] text-gray-700 hover:bg-gray-50';

export default function ChatListRow({
  chat,
  active = false,
  cursor = false,
  unreadCount = 0,
  manualUnread = false,
  snoozeMenuOpen = false,
  showAccount = false, // "כל המספרים" mode: badge which business number owns this thread
  onOpen,
  onTogglePin,
  onToggleRead,
  onToggleSnoozeMenu,
  onSnooze, // (isoString | null)
  onToggleHidden, // manual hide/unhide ("הסתר מהרשימה")
}) {
  const unreadN = unreadCount;
  const manualOnly = manualUnread && unreadN === 0;
  const unread = unreadN > 0 || manualOnly;
  const lastOut = chat.lastMessage?.direction === 'outgoing';
  const snoozed = chat.snoozedUntil && new Date(chat.snoozedUntil) > new Date();
  const isGroup = chat.type === 'group';
  const showPhone = !isGroup && chat.phoneNumber && chat.displayName !== chat.phoneNumber;
  // WhatsApp-style group preview: "יובל: מגיע עוד 10 דקות" — sender name →
  // phone → the same consistent unknown-participant fallback the bubbles use.
  const senderPrefix =
    isGroup && chat.lastMessage && chat.lastMessage.direction === 'incoming'
      ? `${chat.lastMessage.senderName || formatPhoneDisplay(chat.lastMessage.senderPhone) || 'משתתף לא מזוהה'}: `
      : '';
  // Anchors for the canonical AnchoredMenu popovers (snooze presets on
  // desktop; the ⋮ everything-menu on touch devices).
  const snoozeBtnRef = useRef(null);
  const moreBtnRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      data-chat-row={chat.id}
      data-selected={active ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      onClick={() => onOpen(chat)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(chat)}
      className={chatRowClass({ active, cursor })}
    >
      {/* Selected indicator — solid blue accent on the far right (RTL leading) edge. */}
      {active && <span className={CHAT_ROW_ACCENT} />}

      <div className="flex items-start gap-2.5">
        <Avatar chat={chat} />
        <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        {(chat.pinnedAt || chat.providerPinnedAt) && (
          <span
            className="shrink-0 text-[11px] text-gray-400"
            title={chat.pinnedAt ? 'שיחה נעוצה' : 'נעוצה בוואטסאפ בטלפון'}
          >
            📌
          </span>
        )}
        {snoozed && (
          <span className="shrink-0 text-[11px]" title={`בנודניק עד ${fmtSnoozedUntil(chat.snoozedUntil)}`}>💤</span>
        )}
        {/* Provider/GOS state badges — visible only in the 'הכל' scope (these
            chats never reach the active work queue). */}
        {chat.providerDeletedAt && (
          <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-px text-[10px] font-semibold text-red-600 ring-1 ring-red-200" title="השיחה נמחקה בטלפון">
            נמחקה
          </span>
        )}
        {!chat.providerDeletedAt && chat.providerArchivedAt && (
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-semibold text-gray-500 ring-1 ring-gray-200" title="השיחה בארכיון בטלפון">
            בארכיון
          </span>
        )}
        {chat.hiddenAt && (
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-px text-[10px] font-semibold text-gray-500 ring-1 ring-gray-200" title="הוסתרה ידנית מהרשימה">
            מוסתרת
          </span>
        )}
        {/* Identity cluster — the NAME leads, the foreign-number flag follows
            on its TRAILING side (RTL: to the left of the name; mirrors by
            inherited direction in an LTR context), large enough to actually
            read (flag-icons scale with font-size). One cluster so the flag
            rides the NAME — the stretch gap sits between it and the
            timestamp, never between the name and its flag. Israeli numbers
            render nothing (PhoneFlag policy). */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={`min-w-0 truncate text-right text-[14px] ${
              unread ? 'font-bold text-gray-900' : 'font-normal text-gray-600'
            }`}
            dir="auto"
          >
            {chat.displayName && chat.displayName !== chat.phoneNumber ? (
              chat.displayName
            ) : chat.phoneNumber ? (
              <span dir="ltr">{formatPhoneDisplay(chat.phoneNumber)}</span>
            ) : (
              'לא מזוהה'
            )}
          </span>
          {!isGroup && chat.phoneNumber && (
            <PhoneFlag phone={chat.phoneNumber} className="text-[16px]" />
          )}
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
          {senderPrefix}
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
        {/* Owning business number — only in the combined view, where two
            threads with the same person (one per number) must be
            distinguishable at a glance. Canonical account label, quiet chip. */}
        {showAccount && chat.account?.label && (
          <span
            className="max-w-[110px] shrink-0 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100"
            title={`השיחה מתנהלת דרך ${chat.account.label}`}
          >
            {chat.account.label}
          </span>
        )}
        {/* Phone — always visible, on the identity edge. The country flag now
            rides the TITLE line (large), so this stays digits-only. */}
        {showPhone && (
          <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-gray-400" dir="ltr">
            {formatPhoneDisplay(chat.phoneNumber)}
          </span>
        )}
        {isGroup ? (
          // Groups carry NO CRM chips (no deal / contact / needs-attention) —
          // they are read/reply conversations, outside the CRM workflow.
          <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-medium text-gray-500">
            👥 קבוצה
          </span>
        ) : chat.internal ? (
          // INTERNAL business-to-business conversation — the remote side is one
          // of OUR OWN connected numbers (server-derived, #26316). Never a
          // customer: no שיוך chip, no deal chip.
          <span
            className="rounded-full bg-slate-700 px-2 py-0.5 text-[10.5px] font-bold text-white shadow-sm"
            title="שיחה פנימית בין המספרים העסקיים שלנו"
          >
            פנימי
          </span>
        ) : chat.staff ? (
          // INTERNAL STAFF conversation — canonical Staff-module identity
          // (PersonRef, matched server-side). Replaces the CRM chips entirely:
          // a staff chat is never a lead needing שיוך or a deal. Violet is
          // deliberately a color no other badge in this module uses.
          <span
            className="rounded-full bg-violet-600 px-2 py-0.5 text-[10.5px] font-bold text-white shadow-sm"
            title={`שיחת צוות פנימית${chat.staff.name ? ` — ${chat.staff.name}` : ''}`}
          >
            צוות
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
        {/* Action cluster — pin / read / snooze. Revealed by hover on
            hover-capable devices ONLY; touch devices get the ⋮ menu instead
            (hover-gated controls are unreachable on a phone). */}
        <div className="relative mr-auto hidden items-center gap-1 [@media(hover:hover)]:group-hover:flex">
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
            btnRef={snoozeBtnRef}
            title={snoozed ? 'נודניק פעיל' : 'נודניק (הסתרה זמנית)'}
            onClick={() => onToggleSnoozeMenu(chat)}
          >
            💤
          </RowAction>
        </div>
        {/* Touch: one ⋮ opens everything (pin / read / snooze / hide). */}
        <button
          ref={moreBtnRef}
          type="button"
          aria-label="פעולות שיחה"
          onClick={(e) => {
            e.stopPropagation();
            setMoreOpen(true);
          }}
          className="mr-auto hidden h-8 w-8 shrink-0 items-center justify-center rounded-md text-[16px] leading-none text-gray-400 active:bg-gray-200 [@media(hover:none)]:flex"
        >
          ⋮
        </button>
      </div>
        </div>
      </div>
    </div>

    {/* Snooze presets — the canonical anchored popover (portaled: never
        clipped by the list's scroll container, flips near the bottom). */}
    <AnchoredMenu
      anchorRef={snoozeBtnRef}
      open={snoozeMenuOpen}
      onClose={() => onToggleSnoozeMenu(null)}
      width={176}
    >
      {snoozeOptions().map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onSnooze(o.until.toISOString())}
          className={MENU_ITEM}
        >
          {o.label}
        </button>
      ))}
      {snoozed && (
        <button
          type="button"
          onClick={() => onSnooze(null)}
          className="block w-full border-t border-gray-100 px-3 py-2 text-right text-[13px] font-medium text-red-600 hover:bg-red-50"
        >
          ביטול הנודניק
        </button>
      )}
      {/* Permanent manual hide — cleanup for chats that no longer exist
          on the phone (pre-tracking deletions). Reversible from 'הכל'. */}
      {onToggleHidden && (
        <button
          type="button"
          onClick={() => onToggleHidden(chat)}
          className="block w-full border-t border-gray-100 px-3 py-2 text-right text-[13px] text-gray-600 hover:bg-gray-50"
        >
          {chat.hiddenAt ? 'ביטול ההסתרה' : 'הסתרה מהרשימה'}
        </button>
      )}
    </AnchoredMenu>

    {/* Touch ⋮ menu — the row actions the hover cluster provides, plus the
        snooze presets, in one tap-friendly anchored menu. */}
    <AnchoredMenu anchorRef={moreBtnRef} open={moreOpen} onClose={() => setMoreOpen(false)} width={200}>
      <button
        type="button"
        onClick={() => {
          setMoreOpen(false);
          onTogglePin(chat);
        }}
        className={MENU_ITEM}
      >
        📌 {chat.pinnedAt ? 'ביטול נעיצה' : 'נעיצת השיחה'}
      </button>
      <button
        type="button"
        onClick={() => {
          setMoreOpen(false);
          onToggleRead(chat);
        }}
        className={MENU_ITEM}
      >
        {unread ? '✓ סימון כנקראה' : '✉ סימון כלא נקראה'}
      </button>
      <div className="my-1 border-t border-gray-100" />
      {snoozeOptions().map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => {
            setMoreOpen(false);
            onSnooze(o.until.toISOString());
          }}
          className={MENU_ITEM}
        >
          💤 נודניק {o.label}
        </button>
      ))}
      {snoozed && (
        <button
          type="button"
          onClick={() => {
            setMoreOpen(false);
            onSnooze(null);
          }}
          className="block w-full px-3 py-2 text-right text-[13px] font-medium text-red-600 hover:bg-red-50"
        >
          ביטול הנודניק
        </button>
      )}
      {onToggleHidden && (
        <button
          type="button"
          onClick={() => {
            setMoreOpen(false);
            onToggleHidden(chat);
          }}
          className="block w-full border-t border-gray-100 px-3 py-2 text-right text-[13px] text-gray-600 hover:bg-gray-50"
        >
          {chat.hiddenAt ? 'ביטול ההסתרה' : 'הסתרה מהרשימה'}
        </button>
      )}
    </AnchoredMenu>
    </>
  );
}
