import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import Dialog from '../../common/Dialog.jsx';
import ConfirmDialog from '../../common/ConfirmDialog.jsx';
import AlertDialog from '../../common/AlertDialog.jsx';
import Toggle from '../../common/Toggle.jsx';
import ReorderableList from '../../common/ReorderableList.jsx';
import WhatsAppLogo from '../../common/WhatsAppLogo.jsx';
import WhatsAppBodyEditor from '../../communication/WhatsAppBodyEditor.jsx';
import TranslateButton from '../../common/TranslateButton.jsx';
import { registerDynamicFields } from '../../../lib/dynamicFields.js';

// "עריכת תבניות" — the guide wording library, managed from inside the message
// dialog it serves.
//
// Same records, same table, same editor and same conventions as the customer
// template library in CRM Settings: WhatsAppTemplate rows with audience
// 'guide'. Create / edit / activate / reorder / delete all behave identically,
// so an operator who knows one screen knows this one. What differs is the
// variable set the editor offers, which the server decides per audience.
//
// The ★ here is the COMPOSER default: the template "הודעה למדריך" opens with.
// It is deliberately NOT the customer star, which means "sent AUTOMATICALLY to
// new leads" — nothing is ever sent to a guide by itself, and a star that
// promised that would be a lie. Exactly one per audience, enforced in the
// database; zero is valid and means the composer opens empty.
//
// "שליחה דרך" is the number this template is normally sent from. Stored as the
// canonical account id, never the Hebrew label, so renaming a number in admin
// cannot break it. Empty = inherit the audience default (שירות לקוחות).

const LANG_TABS = [
  { key: 'he', label: 'עברית', bodyKey: 'bodyHeHtml' },
  { key: 'en', label: 'English', bodyKey: 'bodyEnHtml' },
];

const emptyDraft = { nameHe: '', bodyHeHtml: '', bodyEnHtml: '', isActive: true, sendAccountId: '' };

const isEmptyHtml = (html) => !html || !String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

function TemplateEditor({ open, initial, variables, categories, meta, onClose, onSubmit }) {
  const [draft, setDraft] = useState(initial);
  const [lang, setLang] = useState('he');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setLang(!isEmptyHtml(initial.bodyHeHtml) || isEmptyHtml(initial.bodyEnHtml) ? 'he' : 'en');
    setError(null);
  }, [open, initial]);

  const bodyKey = LANG_TABS.find((t) => t.key === lang).bodyKey;
  const canSave = !!draft.nameHe.trim() && (!isEmptyHtml(draft.bodyHeHtml) || !isEmptyHtml(draft.bodyEnHtml));
  // What "inherit" actually resolves to, named rather than implied — an
  // operator should never have to guess which number an empty selection means.
  const accounts = meta?.sendAccounts || [];
  const inheritedLabel = accounts.find((a) => a.id === meta?.defaultSendAccountId)?.label || null;
  const chosenAccount = accounts.find(
    (a) => a.id === (draft.sendAccountId || meta?.defaultSendAccountId),
  ) || null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        nameHe: draft.nameHe.trim(),
        bodyHeHtml: draft.bodyHeHtml || '',
        bodyEnHtml: draft.bodyEnHtml || '',
        isActive: draft.isActive,
        // '' means "inherit the audience default" — a real, storable choice,
        // not a missing value.
        sendAccountId: draft.sendAccountId || '',
        audience: 'guide',
      });
    } catch (e) {
      setError(
        e?.payload?.error === 'unsupported_variables'
          ? `יש בנוסח משתנה שלא ניתן למלא בהודעה למדריך: ${(e.payload.keys || []).join(', ')}. השתמשו רק במשתנים מהתפריט.`
          : e?.payload?.error === 'body_required'
            ? 'צריך תוכן לפחות בשפה אחת.'
            : e?.payload?.error === 'unknown_account'
              ? 'מספר השליחה שנבחר אינו זמין במערכת.'
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
      ariaLabel="עריכת תבנית להודעה למדריך"
      title={
        <span className="flex items-center gap-2">
          <WhatsAppLogo size={18} />
          {initial.id ? 'עריכת תבנית' : 'תבנית חדשה'}
        </span>
      }
      footer={
        <>
          <span className="mr-0 ml-auto flex items-center gap-2 text-[12.5px] text-gray-600">
            <Toggle
              checked={draft.isActive}
              onChange={() => setDraft((d) => ({ ...d, isActive: !d.isActive }))}
              label="תבנית פעילה"
            />
            פעילה (מופיעה בבורר)
          </span>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
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
          <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-700">שם התבנית (פנימי)</label>
          <input
            type="text"
            value={draft.nameHe}
            onChange={(e) => setDraft((d) => ({ ...d, nameHe: e.target.value }))}
            placeholder="למשל: תודה על הסיכום"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-[14px] focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1 text-[11.5px] text-gray-400">השם מופיע בבורר התבניות בלבד. המדריך לא רואה אותו.</p>
        </div>

        {/* "שליחה דרך" — the number this template is normally sent from. The
            options are the CANONICAL account list (same rows, same labels,
            same order as every other sending surface); the stored value is the
            account id. It is a PRESELECTION, not a lock: the composer lets the
            operator send this one message from another number without touching
            the template. */}
        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-gray-700">שליחה דרך</label>
          <select
            value={draft.sendAccountId || ''}
            onChange={(e) => setDraft((d) => ({ ...d, sendAccountId: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-[14px] focus:border-emerald-500 focus:outline-none"
          >
            <option value="">
              ברירת מחדל להודעות למדריכים
              {inheritedLabel ? ` — ${inheritedLabel}` : ''}
            </option>
            {(meta?.sendAccounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
                {a.connected ? '' : ' (מנותק)'}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11.5px] text-gray-400">
            המספר שממנו תישלח ההודעה כשבוחרים את התבנית. אפשר לשנות לשליחה בודדת בלי לשנות את התבנית.
          </p>
          {chosenAccount && !chosenAccount.connected && (
            <p className="mt-1 text-[11.5px] font-medium text-amber-700">
              ⚠ המספר הזה מנותק כרגע. הודעה שתישלח דרכו תמתין בתור עד שיתחבר — המערכת לא תשלח מהמספר השני.
            </p>
          )}
        </div>

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
            אפשר למלא שפה אחת בלבד — השנייה פשוט לא תוצע.
            <TranslateButton
              direction={lang === 'en' ? 'he_to_en' : 'en_to_he'}
              getSource={() => draft[lang === 'en' ? 'bodyHeHtml' : 'bodyEnHtml']}
              getTarget={() => draft[bodyKey]}
              onResult={(v) => setDraft((d) => ({ ...d, [bodyKey]: v }))}
            />
          </span>
        </div>

        {/* The Communication Center WhatsApp editor — the same toolbar, chips
            and serializer as every other WhatsApp authoring surface. */}
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

export default function GuideTemplatesDialog({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ variables: [], categories: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [alertMsg, setAlertMsg] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.whatsappTemplates.list(false, 'guide'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    api.whatsappTemplates
      .meta('guide')
      .then((m) => {
        setMeta(m);
        // Chips render their label from the shared registry, by key — so the
        // editor shows "שם פרטי של המדריך", never the technical token.
        registerDynamicFields(
          (m.variables || []).map((v) => ({ key: v.key, label: v.labelHe, description: v.descriptionHe })),
        );
      })
      .catch(() => setMeta({ variables: [], categories: {} }));
  }, [open, refresh]);

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

  // The composer default. No confirmation dialog on purpose — unlike the
  // customer star, this sends nothing to anybody; it only decides what appears
  // in the editor when the composer opens, and it is one click to undo.
  async function toggleDefault(item) {
    try {
      await api.whatsappTemplates.setAudienceDefault(item.id, !item.isAudienceDefault);
      await refresh();
    } catch (e) {
      setAlertMsg(
        e?.payload?.error === 'template_inactive'
          ? 'לא ניתן לסמן תבנית שאינה פעילה. הפעילו אותה קודם.'
          : 'שגיאה: ' + (e.payload?.error || e.message),
      );
    }
  }

  // Account id → the canonical label. Never a hardcoded Hebrew name: renaming
  // a number in admin must rename it here too.
  const accountLabel = (id) =>
    (meta.sendAccounts || []).find((a) => a.id === id)?.label || id || '—';

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
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="xl"
        ariaLabel="תבניות להודעה למדריך"
        title="תבניות להודעה למדריך"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditing({ ...emptyDraft })}
              className="mr-0 ml-auto rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              תבנית חדשה
            </button>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
              סגירה
            </button>
          </>
        }
      >
        <div dir="rtl">
          <p className="mb-3 text-[12.5px] leading-relaxed text-gray-500">
            ניסוחים לשימוש חוזר בהודעות למדריכים. בבחירת תבנית המערכת ממלאת את הפרטים
            (שם המדריך, מתי היה הסיור, הלקוח) — והטקסט נפתח לעריכה חופשית לפני השליחה.
            גררו לשינוי הסדר; הסדר כאן הוא הסדר בבורר.
          </p>
          <p className="mb-3 text-[12.5px] leading-relaxed text-gray-500">
            ★ מסמן את תבנית ברירת המחדל — היא נטענת אוטומטית כשפותחים "הודעה למדריך",
            ואפשר להחליף אותה או למחוק את הטקסט ולכתוב חופשי. בלי ברירת מחדל, המחבר נפתח ריק.
          </p>

          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">טוען…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              שגיאה בטעינה: <span dir="ltr" className="font-mono">{error}</span>
            </div>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-400">
              אין עדיין תבניות. הוסיפו את הראשונה.
            </p>
          ) : (
            <ReorderableList
              items={items}
              onReorder={(ids) => reorder(ids)}
              renderRow={(item, { handle }) => (
                <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${item.isActive ? '' : 'opacity-55'}`}>
                  {handle}
                  {/* The composer default. Disabled on an inactive template —
                      a paused template is offered nowhere and must not be the
                      thing the composer opens with. */}
                  <button
                    type="button"
                    onClick={() => toggleDefault(item)}
                    disabled={!item.isActive && !item.isAudienceDefault}
                    aria-pressed={item.isAudienceDefault}
                    aria-label={
                      item.isAudienceDefault
                        ? `ביטול ${item.nameHe} כתבנית ברירת המחדל`
                        : `הפיכת ${item.nameHe} לתבנית ברירת המחדל`
                    }
                    title={
                      !item.isActive && !item.isAudienceDefault
                        ? 'תבנית לא פעילה — הפעילו אותה כדי לסמן'
                        : 'תבנית ברירת המחדל — נטענת אוטומטית כשפותחים "הודעה למדריך"'
                    }
                    className={`rounded-lg px-2 py-1.5 text-[17px] leading-none transition ${
                      item.isAudienceDefault
                        ? 'text-amber-500 hover:bg-amber-50'
                        : 'text-gray-300 hover:bg-gray-100 hover:text-amber-400'
                    } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
                  >
                    {item.isAudienceDefault ? '★' : '☆'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-gray-900">
                      {item.nameHe}
                      {item.isAudienceDefault && (
                        <span className="mr-2 align-middle rounded-md bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800">
                          ברירת מחדל
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-gray-500">
                      <span className={item.hasHe ? 'text-emerald-700' : 'text-gray-300'}>
                        {item.hasHe ? '● עברית' : '○ עברית'}
                      </span>
                      <span className={item.hasEn ? 'text-emerald-700' : 'text-gray-300'}>
                        {item.hasEn ? '● English' : '○ English'}
                      </span>
                      {/* The sending number, visible on the row itself —
                          "which number does this go from" should never require
                          opening the editor. */}
                      <span className={item.sendAccountId ? 'text-gray-600' : 'text-gray-400'}>
                        · דרך {accountLabel(item.effectiveSendAccountId)}
                        {item.sendAccountId ? '' : ' (ברירת מחדל)'}
                      </span>
                      {!item.isActive && <span className="text-gray-400">· לא פעילה</span>}
                    </p>
                  </div>
                  <Toggle
                    checked={item.isActive}
                    onChange={() => toggleActive(item)}
                    label={item.isActive ? 'כיבוי התבנית' : 'הפעלת התבנית'}
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
        </div>
      </Dialog>

      {editing && (
        <TemplateEditor
          open
          initial={editing}
          variables={meta.variables}
          categories={meta.categories}
          meta={meta}
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
        title="מחיקת תבנית"
        body={
          confirmDelete
            ? `למחוק את התבנית "${confirmDelete.nameHe}"? הודעות שכבר נשלחו לא מושפעות — הן שמורות כטקסט שנשלח בפועל. לא ניתן לבטל פעולה זו.`
            : ''
        }
        confirmLabel="מחק"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => remove(confirmDelete)}
      />

      <AlertDialog open={!!alertMsg} body={alertMsg || ''} onClose={() => setAlertMsg(null)} />
    </>
  );
}
