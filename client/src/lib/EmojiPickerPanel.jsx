import { useEffect, useRef } from 'react';
import { EMOJI_I18N_HE, loadEmojiPicker } from './emojiPickerData.js';

// THE emoji picker surface — one component, every place a person picks an
// emoji: the rich-text toolbars, the WhatsApp composer, and message reactions.
//
// There used to be two: the chat composer mounted its own <emoji-picker> with
// its own Hebrew dictionary and its own dataset import, while the editors went
// through emojiPickerData.js. Two implementations of "pick an emoji" means two
// sets of categories, two loading behaviours and two things to fix — so the
// mounting, the i18n and the lazy dataset now live here once, and callers
// supply only placement and what to do with the result.
//
// This component is PANEL ONLY — it does not position itself. Whoever opens it
// owns that, and should be doing it through AnchoredMenu (the canonical portal)
// so the panel is never clipped by a scroll container.
//
// The catalog is bundled (content-hashed static asset): nothing is fetched from
// an external service at runtime, and the web component + dataset load lazily
// on first open so they never weigh on initial load or on node test runs.
export default function EmojiPickerPanel({
  onPick,
  width = 320,
  height = 300,
  emojiSize = '1.35rem',
  className = '',
}) {
  const hostRef = useRef(null);
  // The handler changes on every parent render (it closes over the draft text,
  // the message, …). Routing it through a ref means the picker mounts ONCE and
  // keeps its search box and scroll position instead of resetting mid-search.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let cancelled = false;
    let picker = null;
    let handler = null;

    loadEmojiPicker()
      .then(({ dataSource }) => {
        if (cancelled || !hostRef.current) return;
        picker = document.createElement('emoji-picker');
        picker.i18n = EMOJI_I18N_HE;
        // NOTE: never touch picker.dataset.source — `data-source` IS the
        // component's data-URL attribute (setting it to a junk string was
        // exactly the loading failure that once left the picker blank).
        picker.dataSource = dataSource;
        picker.style.setProperty('--emoji-size', emojiSize);
        picker.style.width = typeof width === 'number' ? `${width}px` : width;
        picker.style.maxWidth = '88vw';
        picker.style.height = typeof height === 'number' ? `${height}px` : height;
        handler = (e) => {
          const unicode = e?.detail?.unicode;
          if (unicode) onPickRef.current?.(unicode);
        };
        picker.addEventListener('emoji-click', handler);
        hostRef.current.replaceChildren(picker);
      })
      .catch(() => {
        /* offline chunk load — the caller's popover simply shows the fallback */
      });

    return () => {
      cancelled = true;
      if (picker && handler) picker.removeEventListener('emoji-click', handler);
      picker?.remove();
    };
  }, [width, height, emojiSize]);

  return (
    <div ref={hostRef} dir="rtl" className={`overflow-hidden ${className}`}>
      <div
        className="flex items-center justify-center text-[12px] text-gray-400"
        style={{ width: typeof width === 'number' ? `${width}px` : width, height: typeof height === 'number' ? `${height}px` : height }}
      >
        טוען אימוג׳ים…
      </div>
    </div>
  );
}
