import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { MediaMenu } from './MediaImage.jsx';

function stylesFor(widthPct, align) {
  const parts = [`max-width: ${widthPct}%`, 'height: auto'];
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

export const MediaVideo = Node.create({
  name: 'mediaVideo',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: { default: null },
      // Default dropped from 100 → 50. New inserts feel like a media
      // object; old saved videos keep whatever width they already had.
      width: { default: '50' },
      align: { default: 'center' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video[data-type="media-video"]',
        getAttrs: (el) => {
          const src =
            el.getAttribute('src') ||
            el.querySelector('source')?.getAttribute('src');
          if (!src) return false;
          return {
            src,
            width: el.getAttribute('data-width') || '50',
            align: el.getAttribute('data-align') || 'center',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = node.attrs.width || '50';
    const align = node.attrs.align || 'center';
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'media-video',
        'data-width': width,
        'data-align': align,
        controls: 'true',
        preload: 'metadata',
        playsinline: 'true',
        style: stylesFor(width, align),
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoView);
  },

  addCommands() {
    return {
      insertMediaVideo:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

function VideoView({ node, updateAttributes, deleteNode, selected }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [errorText, setErrorText] = useState(null);
  const videoRef = useRef(null);
  const { src, width, align } = node.attrs;

  const wrapAlign =
    align === 'center' ? 'center' : align === 'start' ? 'start' : 'end';

  // Reset load state whenever the source changes (e.g., after a Replace).
  useEffect(() => {
    setPhase('loading');
    setErrorText(null);
  }, [src]);

  function onReadyToPlay() {
    setPhase('ready');
  }

  function onErr() {
    const el = videoRef.current;
    const code = el?.error?.code;
    let msg = 'הסרטון לא ניתן לנגינה';
    if (code === 1) msg = 'טעינה בוטלה';
    else if (code === 2) msg = 'שגיאת רשת';
    else if (code === 3) msg = 'לא ניתן לפענח את הקובץ';
    else if (code === 4) msg = 'הפורמט לא נתמך';
    setErrorText(msg);
    setPhase('error');
  }

  function retry() {
    setPhase('loading');
    setErrorText(null);
    const el = videoRef.current;
    if (el) {
      el.load();
    }
  }

  return (
    <NodeViewWrapper
      as="div"
      dir="rtl"
      className="gos-media-video-wrap"
      style={{
        textAlign: wrapAlign,
        position: 'relative',
        margin: '0.5em 0',
      }}
      contentEditable={false}
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
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          onLoadedData={onReadyToPlay}
          onCanPlay={onReadyToPlay}
          onError={onErr}
          data-type="media-video"
          data-width={width}
          data-align={align}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block',
            borderRadius: '4px',
            background: '#000',
          }}
        />

        {phase === 'loading' && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(17,24,39,0.55)',
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
                width: 26,
                height: 26,
                border: '3px solid rgba(255,255,255,0.25)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'gos-spin 0.9s linear infinite',
              }}
            />
            טוען וידאו…
          </div>
        )}

        {phase === 'error' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(127,29,29,0.85)',
              color: 'white',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '4px',
              gap: 8,
              fontSize: 13,
              padding: 12,
              textAlign: 'center',
            }}
          >
            <div style={{ fontWeight: 600 }}>שגיאה בטעינת וידאו</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{errorText}</div>
            <button
              type="button"
              onClick={retry}
              style={{
                fontSize: 12,
                background: 'white',
                color: 'rgb(127 29 29)',
                border: 0,
                borderRadius: 4,
                padding: '4px 10px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              נסו שוב
            </button>
          </div>
        )}

        <button
          type="button"
          aria-label="הגדרות וידאו"
          title="הגדרות"
          onClick={(e) => {
            e.preventDefault();
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
      {menuOpen && (
        <MediaMenu
          node={node}
          updateAttributes={updateAttributes}
          deleteNode={deleteNode}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </NodeViewWrapper>
  );
}
