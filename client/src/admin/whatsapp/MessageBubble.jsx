import MessageMedia from './MessageMedia.jsx';
import Checks from './Checks.jsx';

// One WhatsApp message, WhatsApp-style: outbound = green bubble on the far
// side (left in RTL, like Hebrew WhatsApp), inbound = white. System events
// render as a centered chip. Group chats show the sender name on inbound.
// Outgoing messages carry the delivery checks (✓ / ✓✓ / blue ✓✓); reactions
// received on a message render as an emoji chip under the bubble.

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
  if (q.textContent) return q.textContent.slice(0, 120);
  return TYPE_LABEL[q.messageType] || 'הודעה';
}

// Group raw reactions ([{emoji, reactorPhone}]) into "👍 2"-style chips.
function groupReactions(list) {
  const counts = new Map();
  for (const r of list || []) {
    if (!r?.emoji) continue;
    counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
  }
  return [...counts.entries()];
}

function HoverAction({ onClick, title, children, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/90 text-[13px] shadow-sm hover:text-gray-800 ${
        active ? 'flex text-amber-500' : 'hidden text-gray-500 group-hover:flex'
      }`}
    >
      {children}
    </button>
  );
}

export default function MessageBubble({ message: m, showSender = false, quoted = null, onReply = null, onToggleStar = null }) {
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
  const sender = m.senderName || m.senderPhone;
  const reactions = groupReactions(m.reactions);

  const actions = (
    <>
      {onReply && (
        <HoverAction onClick={onReply} title="תגובה">↩</HoverAction>
      )}
      {onToggleStar && (
        <HoverAction
          onClick={() => onToggleStar(m)}
          title={m.starred ? 'הסרת כוכב' : 'סימון בכוכב'}
          active={m.starred}
        >
          {m.starred ? '★' : '☆'}
        </HoverAction>
      )}
    </>
  );

  return (
    <div className={`group mb-1.5 flex items-center gap-1 ${outbound ? 'justify-end' : 'justify-start'}`}>
      {/* Hover actions — on the empty side of the row */}
      {outbound && actions}
      <div
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
              {quoted.direction === 'outgoing' ? 'אני' : quoted.senderName || quoted.senderPhone || 'משתתף לא מזוהה'}
            </p>
            <p className="truncate text-[12px] text-gray-600" dir="auto">
              {quotedSnippet(quoted)}
            </p>
          </div>
        )}

        {m.media && <MessageMedia message={m} typeLabel={TYPE_LABEL[m.messageType] || 'קובץ'} />}

        {m.textContent && (
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gray-900" dir="auto">
            {m.textContent}
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
            {reactions.map(([emoji, count]) => (
              <span
                key={emoji}
                className="inline-flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-[11px] shadow ring-1 ring-gray-200"
              >
                <span>{emoji}</span>
                {count > 1 && <span className="text-[10px] text-gray-500">{count}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      {!outbound && actions}
    </div>
  );
}
