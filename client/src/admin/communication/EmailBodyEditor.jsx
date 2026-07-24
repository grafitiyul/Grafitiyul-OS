import { useRef } from 'react';
import RichEditor from '../../editor/RichEditor.jsx';
import VariableMenu from './VariableMenu.jsx';
import { getDynamicFieldByKey } from '../../lib/dynamicFields.js';

// Email content editor: subject line WITH variable support (tokens render as
// readable chips in the live preview under the input; stored as {{key}}), and
// the canonical GOS RichEditor for the body (email toolbar preset) with the
// same category-grouped variable menu.

function SubjectPreview({ value }) {
  const parts = String(value || '').split(/(\{\{[a-z][a-z0-9_]*\}\})/g).filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-gray-500">
      <span className="text-[10.5px] text-gray-400">תצוגה:</span>
      {parts.map((p, i) => {
        const m = /^\{\{([a-z][a-z0-9_]*)\}\}$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const f = getDynamicFieldByKey(m[1]);
        return (
          <span key={i} className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">
            ✦ {f?.label || m[1]}
          </span>
        );
      })}
    </div>
  );
}

export default function EmailBodyEditor({ subject, body, onSubjectChange, onBodyChange, variables, categories, onInsertDocument }) {
  const subjectRef = useRef(null);
  const bodyEditorRef = useRef(null);

  function insertIntoSubject(v) {
    const input = subjectRef.current;
    const token = `{{${v.key}}}`;
    const cur = String(subject || '');
    if (!input) { onSubjectChange(cur + token); return; }
    const start = input.selectionStart ?? cur.length;
    const end = input.selectionEnd ?? cur.length;
    onSubjectChange(cur.slice(0, start) + token + cur.slice(end));
    setTimeout(() => {
      input.focus();
      const pos = start + token.length;
      input.setSelectionRange(pos, pos);
    }, 0);
  }

  return (
    <div dir="rtl" className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[12.5px] font-semibold text-gray-700">שורת נושא</label>
          <VariableMenu variables={variables} categories={categories} onInsert={insertIntoSubject} label="משתנה בנושא" />
        </div>
        <input
          ref={subjectRef}
          type="text"
          value={subject || ''}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder="נושא המייל…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        <SubjectPreview value={subject} />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[12.5px] font-semibold text-gray-700">גוף המייל</label>
          <div className="flex items-center gap-2">
            <VariableMenu variables={variables} categories={categories} editorRef={bodyEditorRef} />
            {onInsertDocument && (
              <button
                type="button"
                onClick={onInsertDocument}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50"
              >
                📎 הוסף מסמך
              </button>
            )}
          </div>
        </div>
        <RichEditor
          value={body || ''}
          onChange={onBodyChange}
          toolbar="email"
          minContentHeight={220}
          placeholder="כתבו כאן את גוף המייל…"
          onEditorReady={(editor) => { bodyEditorRef.current = editor; }}
        />
      </div>
    </div>
  );
}
