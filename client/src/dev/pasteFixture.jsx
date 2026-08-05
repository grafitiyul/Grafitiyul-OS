// DEV-ONLY paste diagnosis fixture — served by `vite` at /paste-fixture.html.
// Mounts the REAL Deal-note surfaces:
//   • the TimelineFeed note composer configuration (RichEditor preset="note"
//     collapsible) + the NoteCard display path (normalizeRichHtml 'tight')
//   • the REAL CollapsibleNote component (the "מידע חשוב על הלקוח" field)
// plus realistic Gmail reading-pane DOM shapes to copy from with a REAL
// browser clipboard. The driving script is client/scripts/paste-rig.mjs.
import { useState } from 'react';
import ReactDOM from 'react-dom/client';
import RichEditor from '../editor/RichEditor.jsx';
import { normalizeRichHtml } from '../editor/htmlNormalize.js';
import { sanitizePastedHtml } from '../editor/pasteSanitizer.js';
import CollapsibleNote from '../admin/common/inline/CollapsibleNote.jsx';
import { InlineEditScope } from '../admin/common/inline/InlineEditScope.jsx';
import '../index.css';

window.__cap = { pastes: [] };

function DealNoteComposerFixture() {
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState('');
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontWeight: 700 }}>Deal note composer (TimelineFeed config)</h2>
      <div
        id="composer"
        onPasteCapture={(e) => {
          window.__cap.pastes.push({
            html: e.clipboardData.getData('text/html'),
            plain: e.clipboardData.getData('text/plain'),
          });
        }}
      >
        <RichEditor
          preset="note"
          collapsible
          value={draft}
          onChange={setDraft}
          placeholder="כתבו פתק…"
          maxHeight="50vh"
          ariaLabel="פתק חדש"
          onEditorReady={(ed) => {
            window.__editor = ed;
          }}
        />
      </div>
      {draft.trim() && (
        <button
          type="button"
          id="save-note"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setSaved(draft);
            window.__savedNote = draft;
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
        >
          שמור פתק
        </button>
      )}
      <h3 style={{ fontWeight: 700, marginTop: 16 }}>NoteCard display</h3>
      <div
        id="notecard"
        className="gos-prose gos-prose-tight text-[15px]"
        dangerouslySetInnerHTML={{ __html: normalizeRichHtml(saved || '', 'tight') }}
      />
    </section>
  );
}

function CustomerInfoFixture() {
  const [value, setValue] = useState('<p>ערך קיים</p>');
  return (
    <section style={{ marginBottom: 32, maxWidth: 480 }}>
      <h2 style={{ fontWeight: 700 }}>מידע חשוב על הלקוח (real CollapsibleNote)</h2>
      <div id="customer-info">
        <InlineEditScope>
          <CollapsibleNote
            id="customerInfo"
            label="מידע חשוב על הלקוח"
            rich
            value={value}
            placeholder="הוסיפו מידע…"
            onSave={async (v) => {
              window.__writes = (window.__writes || 0) + 1;
              await new Promise((r) => setTimeout(r, 150)); // realistic latency
              setValue(v);
            }}
          />
        </InlineEditScope>
      </div>
    </section>
  );
}

// ── realistic Gmail reading-pane DOM shapes ─────────────────────────────────
const GMAIL_SHAPES = {
  // Gmail-composed rich email in the reading pane (div-per-line + <div><br></div>)
  'gmail-divs': `
    <div class="a3s aiL"><div dir="rtl">היי,<div><br></div><div>פסקה ראשונה עם תוכן שממשיך לאורך השורה.</div><div>שורה שנייה באותה פסקה.</div><div><br></div><div>פסקה שנייה כאן.</div><div><br></div><div>תודה,</div><div>דור</div><div><br></div><div>-- </div><div dir="rtl" class="gmail_signature"><div dir="rtl"><div>גרפיטיול סיורים</div><div><a href="https://grafitiyul.co.il" target="_blank">grafitiyul.co.il</a></div></div></div></div></div>`,
  // Plain-text email as Gmail renders it: ONE div, <br>-separated, blank = <br><br>
  'gmail-brs': `
    <div class="a3s aiL">שלום רב,<br>רצינו לבדוק לגבי הסיור.<br><br>יש לנו קבוצה של 20 איש.<br>התאריך המבוקש: 15.9.<br><br>תודה רבה,<br>ורד<br><a href="https://example.com/order/123" target="_blank">example.com/order/123</a><br></div>`,
  // Paragraph divs that carry their blank line as TRAILING <br><br>
  'gmail-trailing-brs': `
    <div dir="rtl"><div>פסקה ראשונה בטקסט.<br><br></div><div>פסקה שנייה בטקסט.<br><br></div><div>פסקה שלישית.</div></div>`,
  // nbsp blank divs + <wbr> in a long link
  'gmail-nbsp-wbr': `
    <div class="a3s"><div dir="rtl"><div>שורה עם קישור <a href="https://x.example/very/long/path">https://x.example/<wbr>very/long/path</a></div><div>&nbsp;</div><div>אחרי שורת רווח ריקה.</div></div></div>`,
};

function GmailPanes() {
  return (
    <section>
      <h2 style={{ fontWeight: 700 }}>Gmail source panes</h2>
      {Object.entries(GMAIL_SHAPES).map(([id, html]) => (
        <div key={id} style={{ border: '1px solid #ccc', margin: '8px 0', padding: 8 }}>
          <div style={{ fontSize: 11, color: '#888' }}>{id}</div>
          <div id={id} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ))}
    </section>
  );
}

// Stage inspector for the rig: recompute the sanitizer output for a captured
// clipboard payload (same function, same rhythm as the Deal-note composer).
window.__sanitize = (html) => sanitizePastedHtml(html, 'tight');
window.__editorHtml = () => (window.__editor ? window.__editor.getHTML() : null);
window.__displayHtml = () => document.getElementById('notecard')?.innerHTML ?? null;

ReactDOM.createRoot(document.getElementById('root')).render(
  <div dir="rtl" style={{ padding: 24, fontFamily: 'system-ui' }}>
    <DealNoteComposerFixture />
    <CustomerInfoFixture />
    <GmailPanes />
  </div>,
);
