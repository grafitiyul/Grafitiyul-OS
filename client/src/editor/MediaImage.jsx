import { useEffect, useRef, useState } from 'react';
import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';

// Alignment is kept as logical start | center | end so RTL stays correct.
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

function stylesFor(widthPct, align) {
  const parts = [`max-width: ${widthPct}%`];
  if (align === 'center') {
    parts.push('display: block', 'margin-inline: auto');
  } else if (align === 'start') {
    parts.push(
      'display: block',
      'margin-inline-end: auto',
      'margin-inline-start: 0',
    );
  } else if (align === 'end') {
    parts.push(
      'display: block',
      'margin-inline-start: auto',
      'margin-inline-end: 0',
    );
  }
  return parts.join('; ');
}

export const MediaImage = Image.extend({
  name: 'mediaImage',

  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: '100' },
      align: { default: 'center' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[data-type="media-image"]',
        getAttrs: (el) => ({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt') || '',
          width: el.getAttribute('data-width') || '100',
          align: el.getAttribute('data-align') || 'center',
        }),
      },
      // Plain <img> fallback so pasted content still works.
      {
        tag: 'img',
        getAttrs: (el) => ({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt') || '',
          width: '100',
          align: 'center',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = node.attrs.width || '100';
    const align = node.attrs.align || 'center';
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'media-image',
        'data-width': width,
        'data-align': align,
        style: stylesFor(width, align),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

function ImageView({ node, updateAttributes, deleteNode, selected }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const imgRef = useRef(null);

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

  const { src, alt, width, align } = node.attrs;
  const wrapAlign =
    align === 'center' ? 'center' : align === 'start' ? 'start' : 'end';

  return (
    <NodeViewWrapper
      as="div"
      dir="rtl"
      className="gos-media-image-wrap"
      style={{ textAlign: wrapAlign, position: 'relative', margin: '0.5em 0' }}
      contentEditable={false}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt || ''}
        data-type="media-image"
        data-width={width}
        data-align={align}
        onClick={(e) => {
          e.preventDefault();
          setMenuOpen((v) => !v);
        }}
        style={{
          maxWidth: `${width}%`,
          height: 'auto',
          display: 'inline-block',
          cursor: 'pointer',
          borderRadius: '4px',
          outline: selected || menuOpen ? '2px solid rgb(37 99 235)' : 'none',
          outlineOffset: '2px',
        }}
      />
      {menuOpen && (
        <MediaMenu
          ref={menuRef}
          node={node}
          updateAttributes={updateAttributes}
          deleteNode={deleteNode}
          onClose={() => setMenuOpen(false)}
          includeAlt
        />
      )}
    </NodeViewWrapper>
  );
}

// Shared menu used by both image and video views.
import { forwardRef } from 'react';
export const MediaMenu = forwardRef(function MediaMenu(
  { node, updateAttributes, deleteNode, onClose, includeAlt = false },
  ref,
) {
  const { width, align } = node.attrs;
  const alt = node.attrs.alt || '';
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
        minWidth: 240,
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
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
