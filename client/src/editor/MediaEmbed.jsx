import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import {
  buildEmbedUrl,
  isKnownProvider,
  providerLabel,
} from './embedProviders.js';
import { MediaMenu } from './MediaImage.jsx';

function wrapperStylesFor(widthPct, align) {
  const parts = [`max-width: ${widthPct}%`];
  if (align === 'center') parts.push('margin-inline: auto');
  else if (align === 'start') parts.push('margin-inline-start: 0', 'margin-inline-end: auto');
  else if (align === 'end') parts.push('margin-inline-start: auto', 'margin-inline-end: 0');
  return parts.join('; ');
}

// Block atom for external video embeds (YouTube / Vimeo) rendered via an
// iframe. The src is always rebuilt from (provider, videoId) — never stored.
// That keeps serialised content safe (no query-parameter injection through
// a crafted paste) and makes it easy to swap privacy domains later.
export const MediaEmbed = Node.create({
  name: 'mediaEmbed',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      provider: { default: null },
      videoId: { default: null },
      width: { default: '75' },
      align: { default: 'center' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="media-embed"]',
        getAttrs: (el) => {
          const provider = el.getAttribute('data-provider');
          const videoId = el.getAttribute('data-video-id');
          if (!isKnownProvider(provider)) return false;
          if (!videoId) return false;
          return {
            provider,
            videoId,
            width: el.getAttribute('data-width') || '75',
            align: el.getAttribute('data-align') || 'center',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const { provider, videoId, width, align } = node.attrs;
    const src = buildEmbedUrl(provider, videoId);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'media-embed',
        'data-provider': provider,
        'data-video-id': videoId,
        'data-width': width,
        'data-align': align,
        class: 'gos-media-embed-figure',
        style: wrapperStylesFor(width, align),
      }),
      [
        'div',
        { class: 'gos-media-embed-frame', style: 'aspect-ratio: 16 / 9;' },
        [
          'iframe',
          {
            src: src || '',
            allow:
              'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share',
            allowfullscreen: 'true',
            referrerpolicy: 'strict-origin-when-cross-origin',
            style:
              'position:absolute; inset:0; width:100%; height:100%; border:0; border-radius:4px;',
          },
        ],
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },

  addCommands() {
    return {
      insertMediaEmbed:
        (attrs) =>
        ({ commands }) => {
          if (!isKnownProvider(attrs?.provider) || !attrs?.videoId) return false;
          return commands.insertContent({ type: this.name, attrs });
        },
    };
  },
});

function EmbedView({ node, updateAttributes, deleteNode, selected }) {
  const { provider, videoId, width, align } = node.attrs;
  const src = buildEmbedUrl(provider, videoId);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
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

  const wrapAlign =
    align === 'center' ? 'center' : align === 'start' ? 'start' : 'end';

  return (
    <NodeViewWrapper
      as="div"
      dir="rtl"
      className="gos-media-embed-wrap"
      data-type="media-embed"
      data-provider={provider}
      data-video-id={videoId}
      data-width={width}
      data-align={align}
      contentEditable={false}
      style={{
        textAlign: wrapAlign,
        position: 'relative',
        margin: '0.5em 0',
      }}
    >
      <div
        style={{
          display: 'inline-block',
          position: 'relative',
          maxWidth: `${width}%`,
          width: '100%',
          outline: selected || menuOpen ? '2px solid rgb(37 99 235)' : 'none',
          outlineOffset: '2px',
          borderRadius: '4px',
        }}
      >
        <div style={{ position: 'relative', aspectRatio: '16 / 9' }}>
          {src ? (
            <iframe
              src={src}
              title={`${providerLabel(provider)} video ${videoId}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                border: 0,
                borderRadius: '4px',
                background: '#000',
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgb(243 244 246)',
                color: 'rgb(107 114 128)',
                fontSize: 13,
                borderRadius: '4px',
              }}
            >
              וידאו לא זמין
            </div>
          )}
          <button
            ref={btnRef}
            type="button"
            aria-label="הגדרות וידאו משובץ"
            title="הגדרות"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            style={{
              position: 'absolute',
              top: 6,
              insetInlineEnd: 6,
              width: 28,
              height: 28,
              borderRadius: 14,
              background: 'rgba(17,24,39,0.65)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            ⋯
          </button>
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'rgb(107 114 128)',
            textAlign: wrapAlign,
          }}
        >
          {providerLabel(provider)}
        </div>
      </div>
      {menuOpen && (
        <MediaMenu
          ref={menuRef}
          node={node}
          updateAttributes={updateAttributes}
          deleteNode={deleteNode}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </NodeViewWrapper>
  );
}
