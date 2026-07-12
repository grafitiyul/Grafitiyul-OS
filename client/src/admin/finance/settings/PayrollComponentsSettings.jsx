import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import { SettingsCard, SortableList, Pill } from '../../crm/settings/catalogKit.jsx';
import { formatMinor, toMinor, minorToInput } from '../../../lib/money.js';

// Payroll component catalog settings. Reuses the shared catalogKit list
// (drag-reorder, inline edit) — component-specific fields ride the kit's
// editSeed/editPanel/editToPatch extension points. System components keep
// their identity (kind/autoRule); everything behavioral is editable here,
// including the auto-rule config (weekend amount, participant bonus).

const VAT_LABELS = { net: 'לפני מע״מ', gross: 'כולל מע״מ', none: 'ללא מע״מ' };
const SCOPE_LABELS = { all: 'הכל', tour: 'סיורים', general: 'תוספת כללית' };

const selectCls =
  'h-10 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200';
const checkCls = 'flex items-center gap-1.5 text-[13px] text-gray-700 whitespace-nowrap';

export default function PayrollComponentsSettings() {
  const [components, setComponents] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { components: rows } = await api.payroll.components.list();
    setComponents(rows);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (components === null) {
    return (
      <div className="px-5 py-8 lg:px-10 max-w-4xl mx-auto">
        <SettingsChrome />
        <div className="text-sm text-gray-400">טוען…</div>
      </div>
    );
  }

  const items = components.map((c) => ({ ...c, label: c.nameHe }));

  return (
    <div className="px-5 py-8 lg:px-10 max-w-4xl mx-auto">
      <SettingsChrome />
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">רכיבי שכר</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed max-w-2xl">
          הקטלוג הקנוני של רכיבי השכר. רכיבים אוטומטיים מחושבים על ידי המנוע;
          רכיבים ידניים מופיעים במטריצת המשרד גם כשהם אפס. שינויים כאן לא משנים
          רשומות שכר קיימות — רק חישובים חדשים (או ״חשב מחדש״ מפורש).
        </p>
      </header>

      <SettingsCard
        title="קטלוג הרכיבים"
        description="גררו לשינוי סדר התצוגה במטריצה. רכיבי מערכת אינם ניתנים למחיקה."
        footer={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              setBusy(true);
              try {
                await api.payroll.components.create({ nameHe: newName.trim() });
                setNewName('');
                await load();
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="רכיב ידני חדש (למשל: חניה, ציוד, מלון…)"
              className="flex-1 min-w-[12rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              הוסף רכיב
            </button>
          </form>
        }
      >
        <SortableList
          items={items}
          emptyText="אין רכיבים"
          onReorder={async (ids) => {
            await api.payroll.components.reorder(ids);
            await load();
          }}
          onRemove={async (item) => {
            if (item.isSystem) {
              alert('רכיב מערכת — לא ניתן למחיקה (אפשר להפוך ללא פעיל).');
              return;
            }
            if (!window.confirm(`למחוק את הרכיב "${item.nameHe}"?`)) return;
            try {
              await api.payroll.components.remove(item.id);
              await load();
            } catch (e) {
              alert(e.payload?.error === 'component_in_use' ? 'לרכיב יש רשומות שכר — לא ניתן למחוק (אפשר להפוך ללא פעיל).' : e.message);
            }
          }}
          renderMeta={(item) => (
            <span className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {item.kind === 'auto' && <Pill>אוטומטי</Pill>}
              {item.sign === -1 && <Pill>ניכוי</Pill>}
              <Pill>{VAT_LABELS[item.vatMode]}</Pill>
              {item.scope !== 'all' && <Pill>{SCOPE_LABELS[item.scope]}</Pill>}
              {(item.autoRule === 'weekend_holiday_percent_of_base' || item.autoRule === 'weekend_holiday') && (
                <Pill>{Math.round((Number(item.config?.multiplier) || 0.5) * 100)}% מהבסיס בשבת/חג</Pill>
              )}
              {item.autoRule === 'participant_bonus' && item.config?.fromParticipants != null && (
                <Pill>מ-{item.config.fromParticipants} · {formatMinor(item.config?.perExtraMinor || 0)}</Pill>
              )}
              {!item.active && <Pill>לא פעיל</Pill>}
            </span>
          )}
          editSeed={(item) => ({
            sign: item.sign,
            vatMode: item.vatMode,
            scope: item.scope,
            officeAlways: item.officeAlways,
            guideVisible: item.guideVisible,
            active: item.active,
            autoRule: item.autoRule,
            isSystem: item.isSystem,
            bonusFrom: item.autoRule === 'participant_bonus' ? String(item.config?.fromParticipants ?? '') : '',
            bonusPer: item.autoRule === 'participant_bonus' ? minorToInput(item.config?.perExtraMinor || 0) : '',
          })}
          editPanel={(draft, setDraft) => (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <select
                value={draft.sign}
                onChange={(e) => setDraft((d) => ({ ...d, sign: Number(e.target.value) }))}
                className={selectCls}
                disabled={draft.isSystem}
              >
                <option value={1}>תשלום (+)</option>
                <option value={-1}>ניכוי (−)</option>
              </select>
              <select
                value={draft.vatMode}
                onChange={(e) => setDraft((d) => ({ ...d, vatMode: e.target.value }))}
                className={selectCls}
              >
                <option value="net">לפני מע״מ (מע״מ יתווסף)</option>
                <option value="gross">הסכום כבר כולל מע״מ</option>
                <option value="none">ללא מע״מ</option>
              </select>
              <select
                value={draft.scope}
                onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))}
                className={selectCls}
                disabled={draft.isSystem}
              >
                <option value="all">כל הפעילויות</option>
                <option value="tour">סיורים בלבד</option>
                <option value="general">תוספת כללית בלבד</option>
              </select>
              <label className={checkCls}>
                <input
                  type="checkbox"
                  checked={draft.officeAlways}
                  onChange={(e) => setDraft((d) => ({ ...d, officeAlways: e.target.checked }))}
                />
                מוצג במשרד גם באפס
              </label>
              <label className={checkCls}>
                <input
                  type="checkbox"
                  checked={draft.guideVisible}
                  onChange={(e) => setDraft((d) => ({ ...d, guideVisible: e.target.checked }))}
                />
                מוצג למדריך
              </label>
              <label className={checkCls}>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
                />
                פעיל
              </label>
              {(draft.autoRule === 'weekend_holiday_percent_of_base' || draft.autoRule === 'weekend_holiday') && (
                <span className="text-[12px] text-gray-500">
                  הסכום אינו קבוע: 50% מתשלום הבסיס של הרשומה, לפי הגדרת שבת/חג
                  הקנונית (הגדרות CRM ← שעות שבת וחג).
                </span>
              )}
              {draft.autoRule === 'participant_bonus' && (
                <>
                  <label className={checkCls}>
                    מעל כמה משתתפים:
                    <input
                      value={draft.bonusFrom}
                      onChange={(e) => setDraft((d) => ({ ...d, bonusFrom: e.target.value }))}
                      dir="ltr"
                      className="w-16 h-10 rounded-lg border border-gray-300 px-2 text-sm"
                    />
                  </label>
                  <label className={checkCls}>
                    ₪ לכל משתתף נוסף:
                    <input
                      value={draft.bonusPer}
                      onChange={(e) => setDraft((d) => ({ ...d, bonusPer: e.target.value }))}
                      dir="ltr"
                      className="w-24 h-10 rounded-lg border border-gray-300 px-2 text-sm"
                    />
                  </label>
                </>
              )}
            </div>
          )}
          editToPatch={(draft) => {
            const patch = {
              sign: draft.sign,
              vatMode: draft.vatMode,
              scope: draft.scope,
              officeAlways: draft.officeAlways,
              guideVisible: draft.guideVisible,
              active: draft.active,
            };
            if (draft.autoRule === 'participant_bonus') {
              const from = Number(draft.bonusFrom);
              patch.config = {
                fromParticipants: Number.isFinite(from) && draft.bonusFrom !== '' ? from : null,
                perExtraMinor: toMinor(draft.bonusPer) || 0,
              };
            }
            return patch;
          }}
          onSave={async (item, patch) => {
            await api.payroll.components.update(item.id, { nameHe: patch.label, ...patch, label: undefined, labelEn: undefined });
            await load();
          }}
        />
      </SettingsCard>
    </div>
  );
}
