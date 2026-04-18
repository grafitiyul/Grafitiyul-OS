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

// Block atom for external video embeds (YouTube / Vimeo / Google Drive)
// rendered via an iframe. The src is always rebuilt from (provider,
// videoId, videoHash) — never stored. That keeps saved content safe and
// makes it easy to swap privacy domains or parameters later.
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
      // Optional Vimeo unlisted-video access hash.
      videoHash: { default: null },
      width: { default: '60' },
      align: { default: 'center' },
      aspectRatio: { default: '16:9' },
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
            videoHash: el.getAttribute('data-video-hash') || null,
            width: el.getAttribute('data-width') || '60',
            align: el.getAttribute('data-align') || 'center',
            aspectRatio: el.getAttribute('data-aspect-ratio') || '16:9',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const { provider, videoId, videoHash, width, align, aspectRatio } =
      node.attrs;
    const src = buildEmbedUrl(provider, videoId, { hash: videoHash });
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'media-embed',
        'data-provider': provider,
        'data-video-id': videoId,
        'data-video-hash': videoHash || '',
        'data-width': width,
        'data-align': align,
        'data-aspect-ratio': aspectRatio || '16:9',
        class: 'gos-media-embed-figure',
        style: wrapperStylesFor(width, align),
      }),
      [
        'div',
        {
          class: 'gos-media-embed-frame',
          style: `position:relative; aspect-ratio: ${(aspectRatio || '16:9').replace(
            ':',
            ' / ',
          )};`,
        },
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
  const { provider, videoId, videoHash, width, align, aspectRatio } =
    node.attrs;
  const src = buildEmbedUrl(provider, videoId, { hash: videoHash });

  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slowLoad, setSlowLoad] = useState(false);
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const iframeRef = useRef(null);

  // Reset load state whenever the URL changes.
  useEffect(() => {
    setLoading(true);
    setSlowLoad(false);
    const timeout = setTimeout(() => {
      if (loading) setSlowLoad(true);
    }, 15000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

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

  const aspectCss = (aspectRatio || '16:9').replace(':', ' / ');
  const isDrive = provider === 'drive';

  return (
    <NodeViewWrapper
      as="div"
      dir="rtl"
      className="gos-media-embed-wrap"
      data-type="media-embed"
      data-provider={provider}
      data-video-id={videoId}
      data-video-hash={videoHash || ''}
      data-width={width}
      data-align={align}
      data-aspect-ratio={aspectRatio || '16:9'}
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
        <div style={{ position: 'relative', aspectRatio: aspectCss }}>
          {src ? (
            <iframe
              ref={iframeRef}
              src={src}
              title={`${providerLabel(provider)} video ${videoId}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setLoading(false)}
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

          {/* Loading overlay: covers the iframe until onLoad fires. */}
          {src && loading && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(17,24,39,0.6)',
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '4px',
                gap: 6,
                fontSize: 12,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  border: '3px solid rgba(255,255,255,0.25)',
                  borderTopColor: 'white',
                  borderRadius: '50%',
                  animation: 'gos-spin 0.9s linear infinite',
                }}
              />
              {slowLoad ? 'טעינה איטית או נכשלה…' : `טוען ${providerLabel(provider)}…`}
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
              width: 32,
              height: 32,
              borderRadius: 16,
              background: 'rgba(17,24,39,0.75)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.15)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            }}
          >
            ⋯
          </button>
        </div>

        {/* Provider label under the embed */}
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

        {/* Drive-specific helper hint — we can't detect Drive permission
            errors cross-origin, so we always show this advice. */}
        {isDrive && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: 'rgb(120 53 15)',
              background: 'rgb(254 243 199)',
              border: '1px solid rgb(253 230 138)',
              borderRadius: 4,
              padding: '4px 8px',
              textAlign: 'start',
              lineHeight: 1.5,
            }}
          >
            אם הסרטון לא מופיע, ודאו שההרשאה של הקובץ היא "כל מי שיש את הקישור"
            (Anyone with the link).
          </div>
        )}
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
