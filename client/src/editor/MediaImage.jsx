import { forwardRef, useEffect, useRef, useState } from 'react';
import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { uploadMediaWithProgress } from './mediaUpload.js';

// Logical alignment values — RTL-safe throughout.
const ALIGNMENTS = [
  { value: 'start', label: 'ימין' },
  { value: 'center', label: 'מרכז' },
  { value: 'end', label: 'שמאל' },
];

const WIDTHS = [
  { value: '25', label: '25%' },
  { value: '50', label: '50%' },
  { value: '75', label: '75%' },
  { value: '100', label: '100%' },
];

function figureStylesFor(widthPct, align) {
  const parts = [`max-width: ${widthPct}%`];
  if (align === 'center') {
    parts.push('margin-inline: auto');
  } else if (align === 'start') {
    parts.push('margin-inline-start: 0', 'margin-inline-end: auto');
  } else if (align === 'end') {
    parts.push('margin-inline-start: auto', 'margin-inline-end: 0');
  }
  return parts.join('; ');
}

// Uses @tiptap/extension-image as the base mark (schema / commands like
// setImage). Extends it with width / align / caption attributes and a
// serialised HTML shape of <figure><img><figcaption></figure>.
//
// Backward compat: slice-4 content that saved bare <img data-type="media-image">
// is still parsed via the fallback `img` rule.
export const MediaImage = Image.extend({
  name: 'mediaImage',

  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: '50' },
      align: { default: 'center' },
      caption: { default: '' },
    };
  },

  parseHTML() {
    return [
      // New shape (this slice and onward).
      {
        tag: 'figure[data-type="media-image-figure"]',
        getAttrs: (el) => {
          const img = el.querySelector('img');
          if (!img) return false;
          const cap = el.querySelector('figcaption');
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt') || '',
            width: el.getAttribute('data-width') || '50',
            align: el.getAttribute('data-align') || 'center',
            caption: cap?.textContent?.trim() || '',
          };
        },
      },
      // Backward compat: slice-4 bare <img data-type="media-image">.
      {
        tag: 'img[data-type="media-image"]',
        getAttrs: (el) => ({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt') || '',
          width: el.getAttribute('data-width') || '100',
          align: el.getAttribute('data-align') || 'center',
          caption: '',
        }),
      },
      // Bare <img> fallback (pasted from elsewhere).
      {
        tag: 'img',
        getAttrs: (el) => ({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt') || '',
          width: '100',
          align: 'center',
          caption: '',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = node.attrs.width || '50';
    const align = node.attrs.align || 'center';
    const caption = node.attrs.caption || '';

    const figureAttrs = {
      'data-type': 'media-image-figure',
      'data-width': width,
      'data-align': align,
      style: figureStylesFor(width, align),
    };

    // Strip Tiptap-internal-only attrs from HTMLAttributes where needed.
    const imgAttrs = mergeAttributes(HTMLAttributes, {
      'data-type': 'media-image',
      style: 'width: 100%; height: auto; display: block; border-radius: 4px;',
    });
    // width/align/caption live on the figure, not the img.
    delete imgAttrs['data-width'];
    delete imgAttrs['data-align'];
    delete imgAttrs.caption;

    const children = [['img', imgAttrs]];
    if (caption) {
      children.push(['figcaption', { class: 'gos-media-caption' }, caption]);
    }
    return ['figure', figureAttrs, ...children];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

function ImageView({ node, updateAttributes, deleteNode, selected }) {
  const { src, alt, width, align, caption } = node.attrs;
  const [menuOpen, setMenuOpen] = useState(false);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [resizing, setResizing] = useState(false);
  const menuRef = useRef(null);
  const imgRef = useRef(null);
  const replaceInputRef = useRef(null);

  // Handle position follows alignment: always at the corner OPPOSITE the
  // alignment anchor. Dragging "away from the anchor" grows the image.
  // - align=start (RTL: right-anchored) → handle on physical left
  // - align=end   (RTL: left-anchored)  → handle on physical right
  // - align=center                      → handle on physical right (arbitrary)
  const handleSide = align === 'end' ? 'right' : 'left';

  const handleRef = useRef(null);

  // Attach resize listeners via native DOM — inside a TipTap node view,
  // React's synthetic pointer events can be swallowed by ProseMirror's
  // own handling. Native addEventListener is reliable.
  useEffect(() => {
    const el = handleRef.current;
    if (!el) return;

    function start(e) {
      e.preventDefault();
      e.stopPropagation();
      const contentEl =
        imgRef.current?.closest('.rt-editor-prose') ||
        imgRef.current?.parentElement;
      if (!contentEl) return;
      const containerWidthPx = contentEl.getBoundingClientRect().width;
      const startX = e.clientX;
      const startWidthPct = Number(node.attrs.width) || 50;
      const startWidthPx = (startWidthPct / 100) * containerWidthPx;

      setResizing(true);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        const cx =
          ev.clientX != null
            ? ev.clientX
            : ev.touches && ev.touches[0]
            ? ev.touches[0].clientX
            : null;
        if (cx == null) return;
        const deltaX = cx - startX;
        const widthDeltaPx = handleSide === 'right' ? deltaX : -deltaX;
        const minPx = containerWidthPx * 0.1;
        const newPx = Math.max(
          minPx,
          Math.min(containerWidthPx, startWidthPx + widthDeltaPx),
        );
        const newPct = Math.max(
          10,
          Math.min(100, Math.round((newPx / containerWidthPx) * 100)),
        );
        updateAttributes({ width: String(newPct) });
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setResizing(false);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      document.addEventListener('touchcancel', onUp);
    }

    el.addEventListener('mousedown', start);
    el.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        const t = e.touches[0];
        start({
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation(),
          clientX: t.clientX,
          clientY: t.clientY,
        });
      }
    }, { passive: false });
    return () => {
      el.removeEventListener('mousedown', start);
    };
  }, [handleSide, node.attrs.width, updateAttributes]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current?.contains(e.target)) return;
      if (imgRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function onPickReplacement(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReplaceBusy(true);
    try {
      const asset = await uploadMediaWithProgress(file, 'image');
      updateAttributes({ src: asset.url });
    } catch (err) {
      alert('החלפת תמונה נכשלה: ' + (err?.message || err));
    } finally {
      setReplaceBusy(false);
    }
  }

  const wrapAlign =
    align === 'center' ? 'center' : align === 'start' ? 'start' : 'end';

  return (
    <NodeViewWrapper
      as="figure"
      dir="rtl"
      className="gos-media-image-figure"
      data-type="media-image-figure"
      data-width={width}
      data-align={align}
      style={{
        textAlign: wrapAlign,
        position: 'relative',
        margin: '0.5em 0',
        maxWidth: `${width}%`,
        marginInline:
          align === 'center' ? 'auto' : undefined,
        marginInlineStart:
          align === 'start' ? 0 : align === 'end' ? 'auto' : undefined,
        marginInlineEnd:
          align === 'end' ? 0 : align === 'start' ? 'auto' : undefined,
      }}
      contentEditable={false}
    >
      <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
        <img
          ref={imgRef}
          src={src}
          alt={alt || ''}
          data-type="media-image"
          data-width={width}
          data-align={align}
          onClick={(e) => {
            if (resizing) return;
            e.preventDefault();
            setMenuOpen((v) => !v);
          }}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            cursor: 'pointer',
            borderRadius: '4px',
            outline:
              selected || menuOpen || resizing
                ? '2px solid rgb(37 99 235)'
                : 'none',
            outlineOffset: '2px',
          }}
        />
        <button
          ref={handleRef}
          type="button"
          aria-label="שינוי גודל תמונה (גרירה)"
          title="גרור כדי לשנות את גודל התמונה"
          onClick={(e) => e.stopPropagation()}
          className="gos-image-resize-handle"
          style={{
            position: 'absolute',
            // Placed at the top corner: the top edge of an image is always
            // the first part visible as the user scrolls into it, so the
            // handle is never clipped even when the image is near the
            // editor's max-height boundary.
            top: 6,
            [handleSide]: 6,
            width: 16,
            height: 16,
            padding: 0,
            background: 'rgb(37 99 235)',
            border: '2px solid white',
            borderRadius: '50%',
            cursor: handleSide === 'right' ? 'nwse-resize' : 'nesw-resize',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            touchAction: 'none',
            zIndex: 5,
          }}
        />
      </div>
      {caption && (
        <figcaption
          className="gos-media-caption"
          style={{
            fontSize: '0.875rem',
            color: 'rgb(107 114 128)',
            marginTop: '0.35em',
            textAlign: 'center',
          }}
        >
          {caption}
        </figcaption>
      )}
      {menuOpen && (
        <MediaMenu
          ref={menuRef}
          node={node}
          updateAttributes={updateAttributes}
          deleteNode={deleteNode}
          onClose={() => setMenuOpen(false)}
          includeAlt
          includeCaption
          onReplace={() => replaceInputRef.current?.click()}
          replaceBusy={replaceBusy}
        />
      )}
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={onPickReplacement}
        style={{ display: 'none' }}
      />
    </NodeViewWrapper>
  );
}

// Shared menu for image + video node views.
export const MediaMenu = forwardRef(function MediaMenu(
  {
    node,
    updateAttributes,
    deleteNode,
    onClose,
    includeAlt = false,
    includeCaption = false,
    onReplace,
    replaceBusy,
  },
  ref,
) {
  const { width, align } = node.attrs;
  const alt = node.attrs.alt || '';
  const caption = node.attrs.caption || '';
  return (
    <div
      ref={ref}
      dir="rtl"
      role="menu"
      className="gos-media-menu"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: '100%',
        insetInlineEnd: 0,
        marginTop: 6,
        background: 'white',
        border: '1px solid rgb(229 231 235)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        padding: 10,
        minWidth: 260,
        zIndex: 30,
        fontSize: 13,
        color: 'rgb(17 24 39)',
      }}
    >
      <MenuSection label="רוחב">
        <div style={{ display: 'flex', gap: 4 }}>
          {WIDTHS.map((w) => (
            <MenuChip
              key={w.value}
              active={String(width) === w.value}
              onClick={() => updateAttributes({ width: w.value })}
            >
              {w.label}
            </MenuChip>
          ))}
        </div>
      </MenuSection>
      <MenuSection label="יישור">
        <div style={{ display: 'flex', gap: 4 }}>
          {ALIGNMENTS.map((a) => (
            <MenuChip
              key={a.value}
              active={align === a.value}
              onClick={() => updateAttributes({ align: a.value })}
            >
              {a.label}
            </MenuChip>
          ))}
        </div>
      </MenuSection>
      {includeCaption && (
        <MenuSection label="כיתוב מתחת לתמונה">
          <input
            value={caption}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
            placeholder="אופציונלי"
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid rgb(209 213 219)',
              borderRadius: 4,
              fontSize: 13,
            }}
          />
        </MenuSection>
      )}
      {includeAlt && (
        <MenuSection label="טקסט חלופי (alt)">
          <input
            value={alt}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
            placeholder="תיאור קצר של התמונה"
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid rgb(209 213 219)',
              borderRadius: 4,
              fontSize: 13,
            }}
          />
        </MenuSection>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          marginTop: 8,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => {
            deleteNode();
            onClose();
          }}
          style={{
            fontSize: 12,
            color: 'rgb(185 28 28)',
            background: 'transparent',
            border: '1px solid rgb(254 202 202)',
            borderRadius: 4,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          הסר
        </button>
        <div style={{ display: 'flex', gap: 6, marginInlineStart: 'auto' }}>
          {onReplace && (
            <button
              type="button"
              onClick={onReplace}
              disabled={replaceBusy}
              style={{
                fontSize: 12,
                color: 'rgb(30 64 175)',
                background: 'rgb(219 234 254)',
                border: '1px solid rgb(191 219 254)',
                borderRadius: 4,
                padding: '4px 10px',
                cursor: replaceBusy ? 'not-allowed' : 'pointer',
                opacity: replaceBusy ? 0.6 : 1,
              }}
            >
              {replaceBusy ? 'מחליף…' : 'החלף'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 12,
              color: 'rgb(55 65 81)',
              background: 'transparent',
              border: '1px solid rgb(209 213 219)',
              borderRadius: 4,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
});

function MenuSection({ label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'rgb(107 114 128)', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function MenuChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        fontSize: 12,
        padding: '4px 8px',
        borderRadius: 4,
        border: '1px solid',
        borderColor: active ? 'rgb(37 99 235)' : 'rgb(229 231 235)',
        background: active ? 'rgb(219 234 254)' : 'white',
        color: active ? 'rgb(30 64 175)' : 'rgb(55 65 81)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
