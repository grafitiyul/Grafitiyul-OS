import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import SettingsChrome from '../../settings/SettingsChrome.jsx';
import { SettingsCard, SortableList, Pill } from '../../crm/settings/catalogKit.jsx';
import { formatMinor, toMinor, minorToInput } from '../../../lib/money.js';

// General activity type catalog (ישיבת צוות, עבודה משרדית, הדרכה…). Each type
// carries defaults for the add-activity dialog: unit price + generic quantity
// UNITS (not necessarily hours) + notes.

const checkCls = 'flex items-center gap-1.5 text-[13px] text-gray-700 whitespace-nowrap';

export default function GeneralActivityTypesSettings() {
  const [types, setTypes] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { types: rows } = await api.payroll.activityTypes.list();
    setTypes(rows);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (types === null) {
    return (
      <div className="px-5 py-8 lg:px-10 max-w-4xl mx-auto">
        <SettingsChrome />
        <div className="text-sm text-gray-400">טוען…</div>
      </div>
    );
  }

  const items = types.map((t) => ({ ...t, label: t.nameHe }));

  return (
    <div className="px-5 py-8 lg:px-10 max-w-4xl mx-auto">
      <SettingsChrome />
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">סוגי תוספת כללית</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed max-w-2xl">
          תוספות שכר שאינן סיור. לכל סוג אפשר להגדיר יחידת מידה (שעה, יום, ק״מ…) —
          היא שמופיעה בפירוט השכר של המדריך: ״₪40 לשעה × 1.5 שעות״.
        </p>
      </header>

      <SettingsCard
        title="קטלוג התוספות"
        footer={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              setBusy(true);
              try {
                await api.payroll.activityTypes.create({ nameHe: newName.trim() });
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
              placeholder="סוג תוספת חדש (ישיבת צוות, יום צילום…)"
              className="flex-1 min-w-[12rem] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              הוסף סוג
            </button>
          </form>
        }
      >
        <SortableList
          items={items}
          emptyText="אין סוגי תוספות — הוסיפו את הראשון למטה."
          onReorder={async (ids) => {
            await api.payroll.activityTypes.reorder(ids);
            await load();
          }}
          onRemove={async (item) => {
            if (!window.confirm(`למחוק את "${item.nameHe}"?`)) return;
            try {
              await api.payroll.activityTypes.remove(item.id);
              await load();
            } catch (e) {
              alert(e.payload?.error === 'type_in_use' ? 'לסוג יש תוספות קיימות — לא ניתן למחוק (אפשר להפוך ללא פעיל).' : e.message);
            }
          }}
          renderMeta={(item) => (
            <span className="flex items-center gap-1.5 shrink-0">
              <Pill>
                {formatMinor(item.defaultUnitPriceMinor)} {item.unitLabelSingularHe ? `ל${item.unitLabelSingularHe}` : 'ליחידה'}
              </Pill>
              <Pill>
                {Number(item.defaultQuantity)} {item.unitLabelPluralHe || item.unitLabelSingularHe || 'יח׳'}
              </Pill>
              {!item.active && <Pill>לא פעיל</Pill>}
            </span>
          )}
          editSeed={(item) => ({
            unitPrice: minorToInput(item.defaultUnitPriceMinor),
            quantity: String(Number(item.defaultQuantity)),
            unitSingular: item.unitLabelSingularHe || '',
            unitPlural: item.unitLabelPluralHe || '',
            defaultNotes: item.defaultNotes || '',
            active: item.active,
          })}
          editPanel={(draft, setDraft) => (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <label className={checkCls}>
                מחיר ליחידה (₪):
                <input
                  value={draft.unitPrice}
                  onChange={(e) => setDraft((d) => ({ ...d, unitPrice: e.target.value }))}
                  dir="ltr"
                  className="w-24 h-10 rounded-lg border border-gray-300 px-2 text-sm"
                />
              </label>
              <label className={checkCls}>
                כמות ברירת מחדל:
                <input
                  value={draft.quantity}
                  onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
                  dir="ltr"
                  className="w-16 h-10 rounded-lg border border-gray-300 px-2 text-sm"
                />
              </label>
              <label className={checkCls}>
                יחידה (יחיד):
                <input
                  value={draft.unitSingular}
                  onChange={(e) => setDraft((d) => ({ ...d, unitSingular: e.target.value }))}
                  placeholder="שעה"
                  className="w-20 h-10 rounded-lg border border-gray-300 px-2 text-sm"
                />
              </label>
              <label className={checkCls}>
                יחידה (רבים):
                <input
                  value={draft.unitPlural}
                  onChange={(e) => setDraft((d) => ({ ...d, unitPlural: e.target.value }))}
                  placeholder="שעות"
                  className="w-20 h-10 rounded-lg border border-gray-300 px-2 text-sm"
                />
              </label>
              <label className={`${checkCls} flex-1 min-w-[12rem]`}>
                הערות:
                <input
                  value={draft.defaultNotes}
                  onChange={(e) => setDraft((d) => ({ ...d, defaultNotes: e.target.value }))}
                  className="flex-1 h-10 rounded-lg border border-gray-300 px-2 text-sm"
                />
              </label>
              <label className={checkCls}>
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
                />
                פעיל
              </label>
            </div>
          )}
          editToPatch={(draft) => ({
            defaultUnitPriceMinor: toMinor(draft.unitPrice) || 0,
            defaultQuantity: Number(draft.quantity) || 1,
            unitLabelSingularHe: draft.unitSingular.trim() || null,
            unitLabelPluralHe: draft.unitPlural.trim() || null,
            defaultNotes: draft.defaultNotes.trim() || null,
            active: draft.active,
          })}
          onSave={async (item, patch) => {
            await api.payroll.activityTypes.update(item.id, { nameHe: patch.label, ...patch, label: undefined, labelEn: undefined });
            await load();
          }}
        />
      </SettingsCard>
    </div>
  );
}
