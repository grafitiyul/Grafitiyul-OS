import { useRef, useState } from 'react';
import MessageMedia from './MessageMedia.jsx';
import Checks from './Checks.jsx';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import EmojiPickerPanel from '../../lib/EmojiPickerPanel.jsx';
import { waTextNodes } from './WaText.jsx';
import { waPlainText } from './waFormat.js';
import { formatPhoneDisplay } from '../../lib/phone.js';

// One WhatsApp message, WhatsApp-style: outbound = green bubble on the far
// side (left in RTL, like Hebrew WhatsApp), inbound = white. System events
// render as a centered chip. Group chats show the sender name on inbound.
// Outgoing messages carry the delivery checks (✓ / ✓✓ / blue ✓✓); reactions
// received on a message render as an emoji chip under the bubble.
//
// Body text renders through waTextNodes — the SHARED WhatsApp markup grammar
// (waFormat.js), so *bold* / _italic_ / ~strike~ / ```mono``` look here exactly
// as they look in the template preview and on the recipient's phone. Links keep
// the shared safe-link markup; the stored textContent is never rewritten.

const TYPE_LABEL = {
  image: 'תמונה',
  video: 'סרטון',
  audio: 'הודעה קולית',
  document: 'מסמך',
  sticker: 'סטיקר',
};

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// Deterministic accent color per sender (group chats) — same trick WhatsApp
// uses so each participant is visually consistent.
const SENDER_COLORS = ['text-rose-600', 'text-blue-600', 'text-emerald-600', 'text-purple-600', 'text-orange-600', 'text-teal-600'];
function senderColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
}

function quotedSnippet(q) {
  if (q.textContent) return waPlainText(q.textContent).slice(0, 120);
  return TYPE_LABEL[q.messageType] || 'הודעה';
}

// Group raw reactions ([{emoji, reactorPhone, reactorName, mine}]) into
// "👍 2"-style chips, remembering which emoji is OURS (server-resolved) so the
// operator can see their own reaction and click it off. Who reacted rides along
// as the chip's title — in a group that is the whole point of a reaction.
function groupReactions(list) {
  const byEmoji = new Map();
  for (const r of list || []) {
    if (!r?.emoji) continue;
    const cur = byEmoji.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false, who: [] };
    cur.count += 1;
    if (r.mine) cur.mine = true;
    cur.who.push(r.mine ? 'אני' : r.reactorName || formatPhoneDisplay(r.reactorPhone) || 'משתתף');
    byEmoji.set(r.emoji, cur);
  }
  return [...byEmoji.values()];
}

// WhatsApp's own quick row. The picker stays deliberately small: reactions are
// a one-click acknowledgement, not an authoring surface.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Revealed by hover on hover-capable devices; on touch the bubble itself is
// tappable and `shown` (owned by the thread) reveals the same actions — hover
// alone would make reply/star unreachable on a phone.
function HoverAction({ onClick, title, children, active = false, shown = false, btnRef = null }) {
  return (
    <button
      ref={btnRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={`h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 text-[14px] shadow-sm hover:text-gray-800 ${
        active
          ? 'flex text-amber-500'
          : shown
            ? 'flex text-gray-500'
            : 'hidden text-gray-500 [@media(hover:hover)]:group-hover:flex'
      }`}
    >
      {children}
    </button>
  );
}

export default function MessageBubble({
  message: m,
  showSender = false,
  quoted = null,
  onReply = null,
  onToggleStar = null,
  onReact = null, // (message, emoji) — '' clears our reaction
  actionsShown = false,
  onBubbleTap = null,
}) {
  const reactBtnRef = useRef(null);
  const bubbleRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The quick row is the default; "+" swaps in the full catalog in place.
  const [fullPicker, setFullPicker] = useState(false);
  const [reacting, setReacting] = useState(false);
  const closePicker = () => {
    setPickerOpen(false);
    setFullPicker(false); // next open starts on the quick row again
  };
  if (m.messageType === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="max-w-[80%] rounded-lg bg-white/70 px-3 py-1 text-center text-[11px] text-gray-500">
          {m.textContent || 'אירוע מערכת'}
        </span>
      </div>
    );
  }

  const outbound = m.direction === 'outgoing';
  // Group sender identity ladder: display name → phone → a consistent
  // "unknown participant" fallback. NEVER hide the label in a group — an
  // unattributed bubble reads as unreliable.
  const sender = m.senderName || formatPhoneDisplay(m.senderPhone);
  const reactions = groupReactions(m.reactions);
  const myEmoji = reactions.find((r) => r.mine)?.emoji || null;

  // One in-flight reaction at a time per bubble: WhatsApp's model is ONE
  // reaction per person, so a second click while the first is still flying
  // would race two different truths onto the same row.
  const react = async (emoji) => {
    if (!onReact || reacting) return;
    closePicker();
    setReacting(true);
    try {
      // Clicking the emoji you already chose removes it, exactly like WhatsApp.
      await onReact(m, emoji === myEmoji ? '' : emoji);
    } finally {
      setReacting(false);
    }
  };

  const actions = (
    <>
      {onReact && (
        <HoverAction
          btnRef={reactBtnRef}
          onClick={() => setPickerOpen((v) => !v)}
          title="תגובת אימוג'י"
          active={!!myEmoji}
          // The action cluster is hover-revealed. While its own popup is open
          // it must STAY revealed, or the operator is picking an emoji with the
          // control they opened it from invisible underneath.
          shown={actionsShown || pickerOpen}
        >
          {myEmoji || '☺'}
        </HoverAction>
      )}
      {onReply && (
        <HoverAction onClick={onReply} title="תגובה" shown={actionsShown}>↩</HoverAction>
      )}
      {onToggleStar && (
        <HoverAction
          onClick={() => onToggleStar(m)}
          title={m.starred ? 'הסרת כוכב' : 'סימון בכוכב'}
          active={m.starred}
          shown={actionsShown}
        >
          {m.starred ? '★' : '☆'}
        </HoverAction>
      )}
    </>
  );

  return (
    <div className={`group mb-1.5 flex items-center gap-1 ${outbound ? 'justify-end' : 'justify-start'}`}>
      {/* Actions — on the empty side of the row (hover, or tap on touch) */}
      {outbound && actions}
      <div
        ref={bubbleRef}
        data-message-bubble={m.id}
        onClick={(e) => {
          // Tap-to-reveal for touch: taps on interactive content (links,
          // media, audio controls) keep their own behavior.
          if (!onBubbleTap) return;
          if (e.target.closest('a,button,audio,video')) return;
          onBubbleTap();
        }}
        className={`relative max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
          outbound ? 'rounded-tl-md bg-[#d9fdd3]' : 'rounded-tr-md bg-white'
        }`}
      >
        {showSender && (
          <p
            className={`mb-0.5 text-[12px] font-semibold ${sender ? senderColor(sender) : 'text-gray-400'}`}
            dir="auto"
          >
            {sender || 'משתתף לא מזוהה'}
          </p>
        )}

        {/* Reply-to context (rendered only when the quoted message is loaded) */}
        {quoted && (
          <div className="mb-1.5 rounded-lg border-r-4 border-emerald-500 bg-black/5 px-2.5 py-1.5">
            <p className="text-[11px] font-semibold text-emerald-700" dir="auto">
              {quoted.direction === 'outgoing' ? 'אני' : quoted.senderName || formatPhoneDisplay(quoted.senderPhone) || 'משתתף לא מזוהה'}
            </p>
            <p className="truncate text-[12px] text-gray-600" dir="auto">
              {quotedSnippet(quoted)}
            </p>
          </div>
        )}

        {m.media && <MessageMedia message={m} typeLabel={TYPE_LABEL[m.messageType] || 'קובץ'} />}

        {m.textContent && (
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gray-900" dir="auto">
            {waTextNodes(m.textContent)}
          </p>
        )}

        <p
          className={`mt-0.5 flex items-center gap-1 text-[10px] text-gray-400 ${
            outbound ? 'justify-start' : 'justify-end'
          }`}
          dir="ltr"
        >
          {outbound && <Checks status={m.deliveryStatus || 'sent'} size={14} />}
          <span>{fmtTime(m.timestampFromSource)}</span>
          {m.starred && <span className="text-[10px] text-amber-500">★</span>}
        </p>

        {reactions.length > 0 && (
          <div className={`-mb-3 mt-0.5 flex translate-y-1.5 gap-1 ${outbound ? 'justify-start' : 'justify-end'}`}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                disabled={!onReact || reacting}
                onClick={(e) => {
                  e.stopPropagation();
                  react(r.emoji);
                }}
                title={r.who.join(', ')}
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] shadow ring-1 ${
                  r.mine ? 'bg-emerald-50 ring-emerald-300' : 'bg-white ring-gray-200'
                } ${onReact ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span className="text-[10px] text-gray-500">{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {!outbound && actions}

      {/* Reaction picker — the canonical anchored popover, so it is never
          clipped by the thread's scroll container and flips/clamps at the
          viewport edges.
          It anchors to the BUBBLE, not to the ☺ button: that button lives in
          the hover-revealed action cluster, so the moment the pointer left the
          row it became `hidden`, its rect collapsed to 0×0, and the popup was
          placed against that — which is how it ended up in a corner of the
          screen instead of next to the message. The bubble is always laid out,
          so the popup can never lose the message it belongs to. */}
      <AnchoredMenu
        anchorRef={bubbleRef}
        open={pickerOpen}
        onClose={closePicker}
        width={fullPicker ? 332 : 258}
        align={outbound ? 'end' : 'start'}
        panelClassName={fullPicker ? 'rounded-2xl p-0' : 'rounded-full px-1.5 py-1'}
      >
        {fullPicker ? (
          // Every emoji — the SAME picker the editors and the chat composer
          // use, not a second selector.
          <EmojiPickerPanel onPick={react} width={330} height={300} />
        ) : (
          <div className="flex items-center justify-center gap-0.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => react(emoji)}
                title={emoji === myEmoji ? 'הסרת התגובה' : emoji}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-[18px] transition hover:bg-gray-100 ${
                  emoji === myEmoji ? 'bg-emerald-100' : ''
                }`}
              >
                {emoji}
              </button>
            ))}
            {/* WhatsApp's "+" — the quick row stays a quick row, and everything
                else is one click away. */}
            <button
              type="button"
              onClick={() => setFullPicker(true)}
              title="עוד אימוג'ים"
              aria-label="עוד אימוג'ים"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-[16px] text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
            >
              +
            </button>
          </div>
        )}
      </AnchoredMenu>
    </div>
  );
}
