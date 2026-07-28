import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import AlertDialog from '../../common/AlertDialog.jsx';
import Toggle from '../../common/Toggle.jsx';
import WhatsAppLogo from '../../common/WhatsAppLogo.jsx';
import WhatsAppBodyEditor from '../../communication/WhatsAppBodyEditor.jsx';
import { SettingsCard } from './catalogKit.jsx';
import { registerDynamicFields } from '../../../lib/dynamicFields.js';

// CRM Settings → "נוסחים לתבניות ווטסאפ". The library of reusable internal
// wording behind the Deal's "תבנית ווטסאפ" action.
//
// These are OUR OWN drafts, not Meta / WhatsApp Business API approved templates:
// nothing is submitted anywhere for approval, and a template is only ever sent
// by an operator through the ordinary connected-chat composer.
//
// One record owns BOTH languages. Authoring reuses the Communication Center's
// WhatsApp editor (same toolbar, same variable chips, same live WhatsApp preview,
// same shared serializer), so what is authored here is exactly what the Deal
// composer receives.

const LANG_TABS = [
  { key: 'he', label: 'עברית', bodyKey: 'bodyHeHtml' },
  { key: 'en', label: 'English', bodyKey: 'bodyEnHtml' },
];

const emptyDraft = { nameHe: '', bodyHeHtml: '', bodyEnHtml: '', isActive: true };

const isEmptyHtml = (html) => !html || !String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

function TemplateEditor({ open, initial, variables, categories, onClose, onSubmit }) {
  const [draft, setDraft] = useState(initial);
  const [lang, setLang] = useState('he');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      // Open on the language the template actually has content in.
      setLang(!isEmptyHtml(initial.bodyHeHtml) || isEmptyHtml(initial.bodyEnHtml) ? 'he' : 'en');
      setError(null);
    }
  }, [open, initial]);

  const bodyKey = LANG_TABS.find((t) => t.key === lang).bodyKey;
  const canSave = !!draft.nameHe.trim() && (!isEmptyHtml(draft.bodyHeHtml) || !isEmptyHtml(draft.bodyEnHtml));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        nameHe: draft.nameHe.trim(),
        bodyHeHtml: draft.bodyHeHtml || '',
        bodyEnHtml: draft.bodyEnHtml || '',
        isActive: draft.isActive,
      });
    } catch (e) {
      setError(
        e?.payload?.error === 'unsupported_variables'
          ? `יש בנוסח משתנה שהמערכת לא יודעת למלא: ${(e.payload.keys || []).join(', ')}. השתמשו רק במשתנים מהתפריט.`
          : e?.payload?.error === 'body_required'
            ? 'צריך תוכן לפחות בשפה אחת.'
            : 'השמירה נכשלה — נסו שוב.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="2xl"
      ariaLabel="עריכת נוסח ווטסאפ"
      title={
        <span className="flex items-center gap-2">
          <WhatsAppLogo size={18} />
          {initial.id ? 'עריכת נוסח' : 'נוסח חדש'}
        </span>
      }
      footer={
        <>
          <span className="mr-0 ml-auto flex items-center gap-2 text-[12.5px] text-gray-600">
            <Toggle
              checked={draft.isActive}
              onChange={() => setDraft((d) => ({ ...d, isActive: !d.isActive }))}
              label="נוסח פעיל"
            />
            פעיל (מופיע בבורר של הדיל)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave || saving}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? 'שומר…' : 'שמירה'}
          </button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
        )}

        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-700">
            שם הנוסח (פנימי)
          </label>
          <input
            type="text"
            value={draft.nameHe}
            onChange={(e) => setDraft((d) => ({ ...d, nameHe: e.target.value }))}
            placeholder="למשל: שליחת פרטים — סיור בחיפה"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-[14px] focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1 text-[11.5px] text-gray-400">
            זה השם שיופיע בבורר הנוסחים בדיל. הלקוח לא רואה אותו.
          </p>
        </div>

        {/* Two languages of the SAME record — tabs, not two separate templates. */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          {LANG_TABS.map((t) => {
            const filled = !isEmptyHtml(draft[t.bodyKey]);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setLang(t.key)}
                className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-medium transition ${
                  lang === t.key
                    ? 'border-emerald-600 text-emerald-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
                <span className={`mr-1.5 text-[11px] ${filled ? 'text-emerald-600' : 'text-gray-300'}`}>
                  {filled ? '●' : '○'}
                </span>
              </button>
            );
          })}
          <span className="mr-auto pb-1.5 text-[11.5px] text-gray-400">
            אפשר למלא שפה אחת בלבד — השנייה פשוט לא תוצע בדיל.
          </span>
        </div>

        {/* The Communication Center WhatsApp editor — toolbar, variable chips and
            the live "כפי שיישלח" preview all come from the one shared editor. */}
        <WhatsAppBodyEditor
          key={lang}
          value={draft[bodyKey] || ''}
          onChange={(html) => setDraft((d) => ({ ...d, [bodyKey]: html }))}
          variables={variables}
          categories={categories}
        />
      </div>
    </Dialog>
  );
}

export default function WhatsAppTemplatesSettings() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ variables: [], categories: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // draft object or null
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [alertMsg, setAlertMsg] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.whatsappTemplates.list());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.whatsappTemplates
      .meta()
      .then((m) => {
        setMeta(m);
        // Chips render their label from the shared registry, by key.
        registerDynamicFields((m.variables || []).map((v) => ({ key: v.key, label: v.labelHe })));
      })
      .catch(() => setMeta({ variables: [], categories: {} }));
  }, [refresh]);

  async function reorder(ids) {
    try {
      await api.whatsappTemplates.reorder(ids);
    } catch (e) {
      setAlertMsg('שגיאה בעדכון הסדר: ' + e.message);
      refresh();
    }
  }

  async function toggleActive(item) {
    try {
      await api.whatsappTemplates.update(item.id, { isActive: !item.isActive });
      await refresh();
    } catch (e) {
      setAlertMsg('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  async function remove(item) {
    try {
      await api.whatsappTemplates.remove(item.id);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      setConfirmDelete(null);
      setAlertMsg('שגיאה במחיקה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-5xl mx-auto">
      <header className="mb-8">
        <SettingsChrome />
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">נוסחים לתבניות ווטסאפ</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-gray-500">
          ניסוחים קבועים לשימוש חוזר בוואטסאפ. בדיל בוחרים נוסח, המערכת ממלאת את
          המשתנים (למשל השם הפרטי של הלקוח) — והטקסט נפתח לעריכה חופשית לפני
          השליחה. אלה נוסחים פנימיים שלנו, לא תבניות מאושרות של WhatsApp Business.
        </p>
      </header>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">טוען…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
        </div>
      ) : (
        <SettingsCard
          title="ספריית הנוסחים"
          description="גררו לשינוי הסדר — זה גם הסדר בבורר של הדיל. נוסח לא פעיל לא מוצע בדיל."
          footer={
            <button
              type="button"
              onClick={() => setEditing({ ...emptyDraft })}
              className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              נוסח חדש
            </button>
          }
        >
          {items.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-gray-400">
              אין עדיין נוסחים. הוסיפו את הראשון.
            </p>
          ) : (
            <ReorderableList
              items={items}
              onReorder={(ids) => reorder(ids)}
              renderRow={(item, { handle }) => (
                <div
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${
                    item.isActive ? '' : 'opacity-55'
                  }`}
                >
                  {handle}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-gray-900">{item.nameHe}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-gray-500">
                      <span className={item.hasHe ? 'text-emerald-700' : 'text-gray-300'}>
                        {item.hasHe ? '● עברית' : '○ עברית'}
                      </span>
                      <span className={item.hasEn ? 'text-emerald-700' : 'text-gray-300'}>
                        {item.hasEn ? '● English' : '○ English'}
                      </span>
                      {!item.isActive && <span className="text-gray-400">· לא פעיל</span>}
                    </p>
                  </div>
                  <Toggle
                    checked={item.isActive}
                    onChange={() => toggleActive(item)}
                    label={item.isActive ? 'כיבוי הנוסח' : 'הפעלת הנוסח'}
                  />
                  <button
                    type="button"
                    onClick={() => setEditing({ ...item })}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    עריכה
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(item)}
                    aria-label={`מחיקת ${item.nameHe}`}
                    className="rounded-lg px-2 py-1.5 text-[15px] text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    🗑
                  </button>
                </div>
              )}
            />
          )}
        </SettingsCard>
      )}

      {editing && (
        <TemplateEditor
          open
          initial={editing}
          variables={meta.variables}
          categories={meta.categories}
          onClose={() => setEditing(null)}
          onSubmit={async (data) => {
            if (editing.id) await api.whatsappTemplates.update(editing.id, data);
            else await api.whatsappTemplates.create(data);
            setEditing(null);
            await refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="מחיקת נוסח"
        body={
          confirmDelete
            ? `למחוק את הנוסח "${confirmDelete.nameHe}"? הודעות שכבר נשלחו לא מושפעות — הן שמורות כטקסט שנשלח בפועל. לא ניתן לבטל פעולה זו.`
            : ''
        }
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => remove(confirmDelete)}
      />

      <AlertDialog open={!!alertMsg} body={alertMsg || ''} onClose={() => setAlertMsg(null)} />
    </div>
  );
}
