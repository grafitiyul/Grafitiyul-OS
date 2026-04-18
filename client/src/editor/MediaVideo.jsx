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
      width: { default: '100' },
      align: { default: 'center' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video[data-type="media-video"]',
        getAttrs: (el) => {
          const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src');
          if (!src) return false;
          return {
            src,
            width: el.getAttribute('data-width') || '100',
            align: el.getAttribute('data-align') || 'center',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = node.attrs.width || '100';
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
  const { src, width, align } = node.attrs;

  const wrapAlign =
    align === 'center' ? 'center' : align === 'start' ? 'start' : 'end';

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
          src={src}
          controls
          playsInline
          preload="metadata"
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
