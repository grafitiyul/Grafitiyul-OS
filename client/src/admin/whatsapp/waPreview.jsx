import { waPreviewHtml } from './waPreview.js';

// THE preview bubble — the visual half of the one WhatsApp renderer (the
// markup→HTML half lives in waPreview.js, kept free of JSX so it can be unit
// tested). Both halves are shared by every surface that previews a WhatsApp
// message, so no screen can invent its own idea of what a message looks like.

export { waPreviewHtml };

const ATTACHMENT_ICON = { image: '🖼️', video: '🎬', document: '📄' };

/**
 * WhatsApp wallpaper, outgoing green bubble, attachments above the text (where
 * WhatsApp puts them), timestamp and double-check.
 *
 * `attachments` is [{ fileName, kind }] — whatever will actually ride along, so
 * the preview is the whole message and not just its words.
 */
export function WhatsAppPreviewBubble({
  markup = '',
  attachments = [],
  title = null,
  emptyText = 'ההודעה תוצג כאן…',
  className = '',
}) {
  return (
    <div
      dir="rtl"
      className={`flex flex-col rounded-xl border border-gray-200 bg-[#efe7dd] p-3 ${className}`}
      style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.035) 1px, transparent 0)',
        backgroundSize: '14px 14px',
      }}
    >
      {title && <div className="mb-2 text-center text-[10.5px] font-medium text-gray-500">{title}</div>}
      <div className="flex-1">
        <div className="mr-auto max-w-[92%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 shadow-sm">
          {attachments.map((a, i) => (
            <div
              key={a.key || a.fileName || i}
              className="mb-2 flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-2 text-[12px] text-gray-700"
            >
              <span className="text-[17px]">{ATTACHMENT_ICON[a.kind] || '📄'}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{a.fileName}</span>
              {a.badge && <span className="text-[10px] text-gray-400">{a.badge}</span>}
            </div>
          ))}
          {markup ? (
            <div
              className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-gray-900"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: waPreviewHtml(markup) }}
            />
          ) : (
            <div className="text-[13px] text-gray-400">{emptyText}</div>
          )}
          <div className="mt-1 text-left text-[10px] text-gray-400">
            {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} ✓✓
          </div>
        </div>
      </div>
    </div>
  );
}
