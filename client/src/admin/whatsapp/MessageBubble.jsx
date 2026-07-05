import MessageMedia from './MessageMedia.jsx';

// One WhatsApp message, WhatsApp-style: outbound = green bubble on the far
// side (left in RTL, like Hebrew WhatsApp), inbound = white. System events
// render as a centered chip. Group chats show the sender name on inbound.

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

export default function MessageBubble({ message: m, showSender = false }) {
  if (m.messageType === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="max-w-[80%] rounded-lg bg-white/70 px-3 py-1 text-center text-[11px] text-gray-500">
          {m.textContent || 'אירוע מערכת'}
        </span>
      </div>
    );
  }

  const outbound = m.direction === 'outbound';
  const sender = m.senderName || m.senderPhone;

  return (
    <div className={`mb-1.5 flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[78%] rounded-2xl px-3 py-2 shadow-sm ${
          outbound ? 'rounded-tl-md bg-[#d9fdd3]' : 'rounded-tr-md bg-white'
        }`}
      >
        {showSender && sender && (
          <p className={`mb-0.5 text-[12px] font-semibold ${senderColor(sender)}`} dir="auto">
            {sender}
          </p>
        )}

        {m.media && <MessageMedia message={m} typeLabel={TYPE_LABEL[m.messageType] || 'קובץ'} />}

        {m.textContent && (
          <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-gray-900" dir="auto">
            {m.textContent}
          </p>
        )}

        <p className={`mt-0.5 text-[10px] text-gray-400 ${outbound ? 'text-left' : 'text-right'}`} dir="ltr">
          {fmtTime(m.timestampFromSource)}
        </p>
      </div>
    </div>
  );
}
