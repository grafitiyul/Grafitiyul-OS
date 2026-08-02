import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import { SettingsCard } from '../../crm/settings/catalogKit.jsx';

// Settings → כספים → "פרטי בנק גרפיטיול" — the canonical default content of
// iCount document notes: structured bank fields, the customer-facing display
// templates ({{token}} moustache) and per-document-type inclusion flags.
//
// The server (accountingDocNotes.js) is the ONE composer — this screen only
// edits the source data. The preview here resolves bank tokens from the
// CURRENT draft fields and deal tokens from server-supplied sample values, so
// the operator always sees the exact paragraph a future document will carry.

const FIELD = 'mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none';
const LABEL = 'block text-[12px] text-gray-600';
const TOKEN_RE = /\{\{([a-z][a-z0-9_]*)\}\}/g;

const DOCTYPE_FLAGS = [
  { suffix: 'IncludeDeal', label: 'חשבון עסקה' },
  { suffix: 'IncludeInvoice', label: 'חשבונית מס' },
];

// Resolve a template for PREVIEW: bank tokens ← draft structured fields,
// deal tokens ← sample values. Unknown tokens stay raw and are reported.
function resolvePreview(template, draft, variables) {
  const map = {};
  for (const v of variables?.bank || []) map[v.key] = String(draft[v.field] || '').trim();
  for (const v of variables?.deal || []) map[v.key] = v.sample;
  const unknown = [];
  const text = String(template || '').replace(TOKEN_RE, (m, key) => {
    if (map[key] != null) return map[key];
    unknown.push(key);
    return m;
  });
  return { text, unknown };
}

// One template block: textarea + click-to-insert variable chips + live
// resolved preview + the per-doctype default-inclusion checkboxes.
function TemplateBlock({ title, description, templateKey, blockPrefix, draft, setDraft, variables, variableGroups }) {
  const taRef = useRef(null);
  const preview = useMemo(
    () => resolvePreview(draft[templateKey], draft, variables),
    [draft, templateKey, variables],
  );

  function insertToken(key) {
    const token = `{{${key}}}`;
    const ta = taRef.current;
    const current = draft[templateKey] || '';
    if (!ta) {
      setDraft((d) => ({ ...d, [templateKey]: current + token }));
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setDraft((d) => ({ ...d, [templateKey]: next }));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + token.length;
    });
  }

  return (
    <SettingsCard title={title} description={description}>
      <div className="space-y-3 px-2 py-1 sm:px-3">
        <label className={LABEL}>
          הנוסח שמופיע בהערות המסמך
          <textarea
            ref={taRef}
            rows={Math.min(10, Math.max(3, String(draft[templateKey] || '').split('\n').length + 1))}
            value={draft[templateKey] || ''}
            onChange={(e) => setDraft((d) => ({ ...d, [templateKey]: e.target.value }))}
            className={`${FIELD} resize-y leading-relaxed`}
            dir="rtl"
          />
        </label>

        {variableGroups.map((group) => (
          <div key={group.title} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-gray-400">{group.title}:</span>
            {group.items.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertToken(v.key)}
                title={`הוספת {{${v.key}}} בנקודת הסמן`}
                className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11.5px] text-blue-700 hover:bg-blue-100"
              >
                ✦ {v.labelHe}
              </button>
            ))}
          </div>
        ))}

        <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2">
          <p className="text-[11px] font-semibold text-gray-400">תצוגה מקדימה (עם ערכים לדוגמה)</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-800" dir="rtl">
            {preview.text || <span className="text-gray-400">— ריק —</span>}
          </p>
          {preview.unknown.length > 0 && (
            <p className="mt-1 text-[12px] text-red-600">
              משתנים לא מוכרים (לא ניתן לשמור): {preview.unknown.map((k) => `{{${k}}}`).join(', ')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[12.5px] text-gray-500">כלול כברירת מחדל ב:</span>
          {DOCTYPE_FLAGS.map(({ suffix, label }) => {
            const key = `${blockPrefix}${suffix}`;
            return (
              <label key={key} className="flex items-center gap-1.5 text-[13px] text-gray-700">
                <input
                  type="checkbox"
                  checked={!!draft[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
                />
                {label}
              </label>
            );
          })}
        </div>
      </div>
    </SettingsCard>
  );
}

export default function BankDetailsSettings() {
  const [data, setData] = useState(null); // { settings, variables }
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.accountingDocSettings.get();
        setData(d);
        setDraft({ ...d.settings });
      } catch (e) {
        setError(e.payload?.error || e.message);
      }
    })();
  }, []);

  const dirty = useMemo(() => {
    if (!data || !draft) return false;
    return Object.keys(draft).some(
      (k) => k !== 'updatedAt' && k !== 'updatedBy' && draft[k] !== data.settings[k],
    );
  }, [data, draft]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { settings } = await api.accountingDocSettings.update(draft);
      setData((d) => ({ ...d, settings }));
      setDraft({ ...settings });
      setSavedAt(Date.now());
    } catch (e) {
      if (e.payload?.error === 'unknown_tokens') {
        const bad = Object.values(e.payload.unknown || {}).flat();
        setError(`לא נשמר — הנוסח מכיל משתנים לא מוכרים: ${bad.map((k) => `{{${k}}}`).join(', ')}`);
      } else {
        setError(e.payload?.error || e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <div className="px-5 py-8 lg:px-10 max-w-4xl mx-auto">
        <SettingsChrome />
        {error ? (
          <div className="text-sm text-red-600">שגיאה בטעינה: {error}</div>
        ) : (
          <div className="text-sm text-gray-400">טוען…</div>
        )}
      </div>
    );
  }

  const variables = data.variables;
  const bankGroup = { title: 'פרטי הבנק', items: variables.bank };
  const dealGroup = { title: 'פרטי הדיל והסיור', items: variables.deal };

  return (
    <div className="px-5 py-8 lg:px-10 max-w-4xl mx-auto">
      <SettingsChrome />
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">פרטי בנק גרפיטיול</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed max-w-2xl">
          התוכן הקבוע שמופיע בהערות של מסמכי הנהלת החשבונות — פרטי חשבון הבנק,
          פרטי הפעילות ותנאי הביטול. הנוסחים נטענים אוטומטית לחלון הפקת המסמך
          וניתנים לעריכה לפני כל הפקה.
        </p>
      </header>

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
        השינויים חלים רק על מסמכים שיופקו מעתה ואילך — מסמכים שכבר הופקו ב־iCount אינם משתנים.
      </div>

      <div className="space-y-5">
        <SettingsCard
          title="פרטי חשבון הבנק"
          description="הנתונים המובנים שמהם נבנה נוסח פרטי הבנק. שינוי כאן מתעדכן אוטומטית בכל נוסח שמשתמש במשתני הבנק."
        >
          <div className="grid grid-cols-1 gap-2 px-2 py-1 sm:grid-cols-3 sm:px-3">
            <label className={LABEL}>שם בעל החשבון
              <input value={draft.bankAccountHolder} onChange={(e) => setDraft((d) => ({ ...d, bankAccountHolder: e.target.value }))} className={FIELD} />
            </label>
            <label className={LABEL}>שם הבנק
              <input value={draft.bankName} onChange={(e) => setDraft((d) => ({ ...d, bankName: e.target.value }))} className={FIELD} />
            </label>
            <label className={LABEL}>מספר הבנק
              <input value={draft.bankNumber} dir="ltr" onChange={(e) => setDraft((d) => ({ ...d, bankNumber: e.target.value }))} className={FIELD} />
            </label>
            <label className={LABEL}>שם הסניף
              <input value={draft.bankBranchName} onChange={(e) => setDraft((d) => ({ ...d, bankBranchName: e.target.value }))} className={FIELD} />
            </label>
            <label className={LABEL}>מספר הסניף
              <input value={draft.bankBranchNumber} dir="ltr" onChange={(e) => setDraft((d) => ({ ...d, bankBranchNumber: e.target.value }))} className={FIELD} />
            </label>
            <label className={LABEL}>מספר החשבון
              <input value={draft.bankAccountNumber} dir="ltr" onChange={(e) => setDraft((d) => ({ ...d, bankAccountNumber: e.target.value }))} className={FIELD} />
            </label>
          </div>
        </SettingsCard>

        <TemplateBlock
          title="נוסח פרטי הבנק במסמך"
          description="הפסקה שמופיעה בהערות המסמך. משתני הבנק נמשכים מהנתונים המובנים למעלה — עדכון נתון מעדכן את הנוסח בכל מסמך עתידי."
          templateKey="bankTemplate"
          blockPrefix="bank"
          draft={draft}
          setDraft={setDraft}
          variables={variables}
          variableGroups={[bankGroup]}
        />

        <TemplateBlock
          title="נוסח תנאי ביטול ודחייה"
          description="מדיניות הביטול והדחייה כפי שהיא מופיעה ללקוח בהערות המסמך."
          templateKey="cancellationTemplate"
          blockPrefix="cancellation"
          draft={draft}
          setDraft={setDraft}
          variables={variables}
          variableGroups={[dealGroup]}
        />

        <TemplateBlock
          title="פרטי הפעילות במסמך"
          description="שורות הפתיחה של הערות המסמך — שם הקבוצה, תאריך הסיור וכמות המשתתפים נמשכים אוטומטית מהדיל."
          templateKey="dealInfoTemplate"
          blockPrefix="dealInfo"
          draft={draft}
          setDraft={setDraft}
          variables={variables}
          variableGroups={[dealGroup]}
        />
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-gray-200 bg-white/95 py-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'שומר…' : 'שמירת ההגדרות'}
        </button>
        {!dirty && savedAt && <span className="text-[13px] text-emerald-700">✓ נשמר</span>}
        {dirty && <span className="text-[13px] text-gray-500">יש שינויים שלא נשמרו</span>}
        {error && <span className="text-[13px] text-red-600">{error}</span>}
      </div>
    </div>
  );
}
