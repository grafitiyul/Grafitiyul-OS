import { useEffect, useMemo, useState } from 'react';
import SettingsChrome from './SettingsChrome.jsx';
import Toggle from '../common/Toggle.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { MODULE_REGISTRY } from '../../shell/modules.js';
import { resolveNav, toPreferencePayload } from '../../shell/navResolve.js';
import { useNavConfig, saveNavConfig, resetNavConfig } from '../../shell/navConfig.jsx';

// ניווט ותפריטים — the administrative control over the main navigation.
//
// The modules themselves are code (routes, screens, icons); this screen only
// decides which of them sit in the navigation rail, in which group, and in what
// order. Saving writes one NavPreference row per module, so order stops
// depending on registry position and a future module can be added anywhere.
//
// Two guarantees the UI must make visible:
//   • הגדרות and בקרה are pinned — their switch is disabled, because hiding
//     Settings would hide this very screen.
//   • Anything switched off is not lost: it keeps a card in הגדרות →
//     מודולים לניהול. The empty-state text says so explicitly.

// Reorder one rail group without disturbing the other group's positions: the
// group's members keep the slots they already occupy in the global order, and
// only their sequence within those slots changes.
function reorderWithin(all, groupKeys, nextKeys) {
  const inGroup = new Set(groupKeys);
  const slots = [];
  all.forEach((m, i) => {
    if (inGroup.has(m.key)) slots.push(i);
  });
  const byKey = new Map(all.map((m) => [m.key, m]));
  const next = [...all];
  nextKeys.forEach((k, i) => {
    if (slots[i] !== undefined && byKey.has(k)) next[slots[i]] = byKey.get(k);
  });
  return next;
}

export default function NavigationSettings() {
  const { prefs, setPrefs } = useNavConfig();
  const resolved = useMemo(() => resolveNav(MODULE_REGISTRY, prefs), [prefs]);

  const [modules, setModules] = useState(resolved.all);
  const [baseline, setBaseline] = useState(() => JSON.stringify(toPreferencePayload(resolved.all)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-sync whenever the stored configuration changes (first load, save, reset).
  useEffect(() => {
    setModules(resolved.all);
    setBaseline(JSON.stringify(toPreferencePayload(resolved.all)));
  }, [resolved]);

  const payload = useMemo(() => toPreferencePayload(modules), [modules]);
  const dirty = JSON.stringify(payload) !== baseline;

  const primary = modules.filter((m) => m.inNav && m.railGroup === 'primary');
  const utility = modules.filter((m) => m.inNav && m.railGroup === 'utility');
  const hidden = modules.filter((m) => !m.inNav);

  function patch(key, changes) {
    setModules((list) => list.map((m) => (m.key === key ? { ...m, ...changes } : m)));
    setError(null);
  }

  function handleReorder(group, nextKeys) {
    setModules((list) => reorderWithin(list, group.map((m) => m.key), nextKeys));
    setError(null);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      setPrefs(await saveNavConfig(payload));
    } catch {
      setError('השמירה נכשלה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setError(null);
    try {
      setPrefs(await resetNavConfig());
    } catch {
      setError('האיפוס נכשל. נסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-8 lg:px-10 lg:py-10 max-w-4xl mx-auto">
      <SettingsChrome />
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">ניווט ותפריטים</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          בחרו אילו מודולים יופיעו בתפריט הראשי ובאיזה סדר. מודול שכובה כאן לא
          נעלם — הוא נשאר זמין תמיד מתוך מסך ההגדרות.
        </p>
      </header>

      <div className="space-y-6">
        <GroupPanel
          title="חלק עליון"
          hint="העבודה היומיומית. מופיע בראש סרגל הניווט."
          items={primary}
          otherGroupLabel="החלק התחתון"
          onReorder={(keys) => handleReorder(primary, keys)}
          onPatch={patch}
          emptyText="אין כאן מודולים."
        />
        <GroupPanel
          title="חלק תחתון"
          hint="מודולים ניהוליים ופחות שכיחים. נצמד לתחתית הסרגל."
          items={utility}
          otherGroupLabel="החלק העליון"
          onReorder={(keys) => handleReorder(utility, keys)}
          onPatch={patch}
          emptyText="אין כאן מודולים."
        />

        <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/70 p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-gray-900">לא מופיעים בתפריט</h2>
          <p className="mt-1 mb-4 text-[13px] leading-relaxed text-gray-500">
            נגישים תמיד דרך הגדרות → מודולים לניהול. הדליקו כדי להחזיר לתפריט
            הראשי.
          </p>
          {hidden.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-400">
              כל המודולים מופיעים בתפריט הראשי.
            </p>
          ) : (
            <ul className="space-y-2">
              {hidden.map((m) => (
                <li key={m.key}>
                  <ModuleRow module={m} onPatch={patch} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Persistent action bar — the screen is a workspace, so the primary
          action stays reachable without scrolling back up. */}
      <div className="sticky bottom-0 mt-8 -mx-5 border-t border-gray-200 bg-white/95 px-5 py-3 backdrop-blur lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[13px] text-gray-500">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : dirty ? (
              'יש שינויים שלא נשמרו.'
            ) : (
              'הכול שמור.'
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={busy}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3.5 text-[13px] font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
            >
              החזרה לברירת המחדל
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !dirty}
              className="h-9 rounded-lg bg-blue-600 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-40"
            >
              {busy ? 'שומר…' : 'שמירה'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupPanel({ title, hint, items, otherGroupLabel, onReorder, onPatch, emptyText }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-[13px] text-gray-500">{hint}</p>
      </div>
      <ReorderableList
        items={items.map((m) => ({ ...m, id: m.key }))}
        onReorder={onReorder}
        emptyText={emptyText}
        renderRow={(item, { handle }) => (
          <ModuleRow module={item} handle={handle} otherGroupLabel={otherGroupLabel} onPatch={onPatch} />
        )}
      />
    </section>
  );
}

function ModuleRow({ module: m, handle, otherGroupLabel, onPatch }) {
  const Icon = m.Icon;
  const nextGroup = m.railGroup === 'primary' ? 'utility' : 'primary';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
      {handle}
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-900 text-[17px] leading-none">
        {Icon ? <Icon size={18} /> : m.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-gray-900">{m.label}</span>
          {m.pinned && (
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
              קבוע
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-gray-500">{m.description}</p>
      </div>
      {otherGroupLabel && (
        <button
          type="button"
          onClick={() => onPatch(m.key, { railGroup: nextGroup })}
          className="hidden shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] text-gray-600 transition hover:bg-gray-50 hover:text-gray-900 sm:block"
        >
          העברה ל{otherGroupLabel}
        </button>
      )}
      <Toggle
        checked={m.inNav}
        disabled={m.pinned}
        label={m.pinned ? `${m.label} — מוצג תמיד בתפריט` : `הצגת ${m.label} בתפריט הראשי`}
        onChange={(v) => onPatch(m.key, { inNav: v })}
      />
    </div>
  );
}
