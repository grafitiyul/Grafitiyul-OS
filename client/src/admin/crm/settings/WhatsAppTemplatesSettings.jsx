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
import TranslateButton from '../../common/TranslateButton.jsx';
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

// Chip labels are registered SYNCHRONOUSLY at module load, not only from the
// async /meta response: the editor can open before meta resolves, and an
// unregistered key renders as the amber "unknown field" chip showing the raw
// {{customer_first_name}} — exactly the technical name CRM authors must never
// need to read. The registry is still the source of truth for the KEY and for
// resolution; this is a display-label fallback, not a second registry (meta
// refreshes the same entry a moment later).
registerDynamicFields([
  {
    key: 'customer_first_name',
    label: 'שם פרטי של הלקוח',
    description: 'מתמלא אוטומטית בשם הפרטי של הלקוח בדיל',
  },
]);

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
          <span className="mr-auto flex items-center gap-2 pb-1.5 text-[11.5px] text-gray-400">
            אפשר למלא שפה אחת בלבד — השנייה פשוט לא תוצע בדיל.
            {/* Shared AI translate between the two language TABS of the same
                record: source = the other tab, target = the open one. */}
            <TranslateButton
              direction={lang === 'en' ? 'he_to_en' : 'en_to_he'}
              getSource={() => draft[lang === 'en' ? 'bodyHeHtml' : 'bodyEnHtml']}
              getTarget={() => draft[bodyKey]}
              onResult={(v) => setDraft((d) => ({ ...d, [bodyKey]: v }))}
            />
          </span>
        </div>

        {/* The Communication Center WhatsApp editor — toolbar, variable chips and
            the live "כפי שיישלח" preview all come from the one shared editor. */}
        {/* showVariableKeys={false}: CRM authors pick "שם פרטי של הלקוח", never
            a technical key. The chip and the stored token are unchanged. */}
        <WhatsAppBodyEditor
          key={lang}
          value={draft[bodyKey] || ''}
          onChange={(html) => setDraft((d) => ({ ...d, [bodyKey]: html }))}
          variables={variables}
          categories={categories}
          showVariableKeys={false}
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
  // { item, action: 'star' | 'unstar' } — the star confirmation.
  const [starTarget, setStarTarget] = useState(null);

  const starred = items.find((t) => t.isNewLeadDefault) || null;

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
        registerDynamicFields(
          (m.variables || []).map((v) => ({ key: v.key, label: v.labelHe, description: v.descriptionHe })),
        );
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

  // Starring is a customer-facing switch (it turns automatic replies on), so it
  // always goes through a confirmation that states exactly what will happen —
  // including the language gap when the template has only one language.
  function requestStar(item) {
    if (item.isNewLeadDefault) return setStarTarget({ item, action: 'unstar' });
    setStarTarget({ item, action: 'star' });
  }

  async function applyStar() {
    const { item, action } = starTarget;
    try {
      await api.whatsappTemplates.setNewLeadDefault(item.id, action === 'star');
      setStarTarget(null);
      await refresh();
    } catch (e) {
      setStarTarget(null);
      setAlertMsg(
        e?.payload?.error === 'template_inactive'
          ? 'לא ניתן לסמן נוסח שאינו פעיל. הפעילו אותו קודם.'
          : 'שגיאה: ' + (e.payload?.error || e.message),
      );
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
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-6xl mx-auto">
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
        <>
        {/* The automatic-reply state, stated plainly and separately from the
            library below — this is a different concept from "a nice default to
            pick when writing a message by hand", and the two must never read as
            the same thing. */}
        <section
          className={`mb-5 rounded-xl border px-5 py-4 ${
            starred ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className={`text-[18px] leading-none ${starred ? 'text-amber-500' : 'text-gray-300'}`}>
              {starred ? '★' : '☆'}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold text-gray-900">הודעת ברירת מחדל לליד חדש</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600">
                נשלחת אוטומטית רק ללידים חדשים ממקורות חיצוניים (טפסים באתר, מודעות
                Meta וכדומה). שפת ההודעה נקבעת לפי קידומת הטלפון: מספר ישראלי מקבל
                עברית, מספר זר מקבל אנגלית.
                <br />
                זו אינה ברירת מחדל לשליחה ידנית — בדיל בוחרים נוסח כרגיל.
              </p>
              <p className="mt-2 text-[12.5px] font-medium">
                {starred ? (
                  <span className="text-emerald-800">
                    כרגע נשלח: “{starred.nameHe}”
                    {(!starred.hasHe || !starred.hasEn) && (
                      <span className="text-amber-700">
                        {' '}· חסר {!starred.hasHe ? 'נוסח בעברית' : 'נוסח באנגלית'} —
                        {!starred.hasHe ? ' לידים ישראליים' : ' לידים זרים'} לא יקבלו תשובה
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-gray-500">
                    כרגע לא מסומן אף נוסח — לא נשלחת תשובה אוטומטית ללידים חדשים. זו הגדרה
                    תקינה.
                  </span>
                )}
              </p>
            </div>
          </div>
        </section>

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
                  {/* The star. Disabled on inactive templates — an inactive
                      template is offered nowhere and must never be the thing
                      that answers a real customer. */}
                  <button
                    type="button"
                    onClick={() => requestStar(item)}
                    disabled={!item.isActive && !item.isNewLeadDefault}
                    aria-pressed={item.isNewLeadDefault}
                    aria-label={
                      item.isNewLeadDefault
                        ? `ביטול הסימון של ${item.nameHe} כהודעת ברירת מחדל לליד חדש`
                        : `סימון ${item.nameHe} כהודעת ברירת מחדל לליד חדש`
                    }
                    title={
                      !item.isActive && !item.isNewLeadDefault
                        ? 'נוסח לא פעיל — הפעילו אותו כדי לסמן'
                        : 'הודעת ברירת מחדל לליד חדש — נשלחת אוטומטית רק ללידים ממקורות חיצוניים'
                    }
                    className={`rounded-lg px-2 py-1.5 text-[17px] leading-none transition ${
                      item.isNewLeadDefault
                        ? 'text-amber-500 hover:bg-amber-50'
                        : 'text-gray-300 hover:bg-gray-100 hover:text-amber-400'
                    } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
                  >
                    {item.isNewLeadDefault ? '★' : '☆'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-gray-900">
                      {item.nameHe}
                      {item.isNewLeadDefault && (
                        <span className="mr-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800 align-middle">
                          ברירת מחדל לליד חדש
                        </span>
                      )}
                    </p>
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
        </>
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

      {/* Starring turns on real messages to real strangers, so the dialog names
          the consequence, names which language gap exists (if any), and names
          the template that loses the star. */}
      <ConfirmDialog
        open={!!starTarget}
        title={starTarget?.action === 'unstar' ? 'ביטול התשובה האוטומטית' : 'הודעת ברירת מחדל לליד חדש'}
        body={
          !starTarget
            ? ''
            : starTarget.action === 'unstar'
              ? `לבטל את הסימון של "${starTarget.item.nameHe}"? מרגע זה לא תישלח תשובה אוטומטית ללידים חדשים ממקורות חיצוניים.`
              : [
                  `הנוסח "${starTarget.item.nameHe}" יישלח אוטומטית לכל ליד חדש שנכנס ממקור חיצוני.`,
                  starTarget.item.hasHe && starTarget.item.hasEn
                    ? 'לידים ישראליים יקבלו את הנוסח בעברית, לידים זרים באנגלית.'
                    : !starTarget.item.hasEn
                      ? '⚠ לנוסח הזה אין תוכן באנגלית — לידים עם מספר טלפון זר לא יקבלו שום תשובה (המערכת לא תשלח להם עברית).'
                      : '⚠ לנוסח הזה אין תוכן בעברית — לידים עם מספר טלפון ישראלי לא יקבלו שום תשובה (המערכת לא תשלח להם אנגלית).',
                  starred && starred.id !== starTarget.item.id
                    ? `הסימון יוסר מהנוסח "${starred.nameHe}".`
                    : null,
                ]
                  .filter(Boolean)
                  .join('\n\n')
        }
        confirmLabel={starTarget?.action === 'unstar' ? 'בטל סימון' : 'סמן נוסח'}
        danger={starTarget?.action === 'star' && !(starTarget?.item.hasHe && starTarget?.item.hasEn)}
        onCancel={() => setStarTarget(null)}
        onConfirm={applyStar}
      />

      <AlertDialog open={!!alertMsg} body={alertMsg || ''} onClose={() => setAlertMsg(null)} />
    </div>
  );
}
