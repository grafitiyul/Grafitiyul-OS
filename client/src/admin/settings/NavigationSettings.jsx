import { useEffect, useMemo, useState } from 'react';
import SettingsChrome from './SettingsChrome.jsx';
import ReorderableList from '../common/ReorderableList.jsx';
import { MODULE_REGISTRY } from '../../shell/modules.js';
import { resolveNav, toPreferencePayload } from '../../shell/navResolve.js';
import { useNavConfig, saveNavConfig, resetNavConfig } from '../../shell/navConfig.jsx';

// ניהול התפריט — the administrative control over the main navigation, opened
// from the "מודולים לניהול" section header in Settings.
//
// The modules themselves are code (routes, screens, icons); this screen only
// decides where each one sits. It shows THREE areas that mirror the rail
// exactly — מוצמדים למעלה, מוצמדים למטה, לא מופיעים בתפריט — and every module
// in the system appears in exactly one of them, so the screen is always a
// complete picture.
//
// Placement is a single explicit three-way control per module rather than a
// switch plus a move button: "where is this module" is one question with three
// answers, and a switch can only ever answer half of it. It is also what makes
// every move one click — up→down, down→up, either→hidden, hidden→either.
//
// הגדרות and בקרה are PINNED: they stay listed, with their status stated, but
// their "מוסתר" option is disabled. Hiding הגדרות would hide this very screen.

const PLACEMENTS = [
  { value: 'primary', label: 'למעלה' },
  { value: 'utility', label: 'למטה' },
  { value: 'hidden', label: 'מוסתר' },
];

const placementOf = (m) => (m.inNav ? m.railGroup : 'hidden');

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

  function setPlacement(key, placement) {
    setModules((list) =>
      list.map((m) =>
        m.key === key
          ? placement === 'hidden'
            ? { ...m, inNav: false }
            : { ...m, inNav: true, railGroup: placement }
          : m,
      ),
    );
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
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">ניהול התפריט</h1>
        <p className="text-[15px] text-gray-500 mt-1.5 leading-relaxed">
          קובעים מה מופיע בתפריט הראשי, באיזו קבוצה ובאיזה סדר. אפשר לגרור כדי
          לסדר, ולבחור לכל מודול אם הוא מוצמד למעלה, מוצמד למטה או לא מופיע
          בתפריט. מודול שאינו בתפריט לא נעלם — הוא נשאר זמין תמיד בהגדרות, תחת
          "מודולים לניהול".
        </p>
      </header>

      <RailPreview primary={primary} utility={utility} />

      <div className="mt-6 space-y-6">
        <GroupPanel
          title="מוצמדים למעלה"
          hint="נפתחים בראש סרגל הניווט — העבודה היומיומית."
          items={primary}
          count={primary.length}
          onReorder={(keys) => handleReorder(primary, keys)}
          onPlacement={setPlacement}
          emptyText="אין מודולים מוצמדים למעלה."
        />
        <GroupPanel
          title="מוצמדים למטה"
          hint="נצמדים לתחתית הסרגל — מודולים ניהוליים ופחות שכיחים."
          items={utility}
          count={utility.length}
          onReorder={(keys) => handleReorder(utility, keys)}
          onPlacement={setPlacement}
          emptyText="אין מודולים מוצמדים למטה."
        />

        <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/70 p-4 sm:p-5">
          <PanelHeading
            title="לא מופיעים בתפריט"
            hint="נגישים תמיד מתוך הגדרות → מודולים לניהול. בחרו למעלה או למטה כדי להחזיר לסרגל."
            count={hidden.length}
          />
          {hidden.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-gray-400">
              כל המודולים מופיעים בתפריט הראשי.
            </p>
          ) : (
            <ul className="space-y-2">
              {hidden.map((m) => (
                <li key={m.key}>
                  <ModuleRow module={m} onPlacement={(p) => setPlacement(m.key, p)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-gray-400">
        המודולים המסומנים "קבוע" — בקרה והגדרות — תמיד מופיעים בתפריט. אפשר
        להעביר אותם בין הקבוצות ולשנות את סדרם, אבל לא להסתיר אותם: הסתרת הגדרות
        הייתה מסתירה גם את המסך הזה.
      </p>

      {/* Persistent action bar — the screen is a workspace, so the primary
          action stays reachable without scrolling back up. */}
      <div className="sticky bottom-0 mt-6 -mx-5 border-t border-gray-200 bg-white/95 px-5 py-3 backdrop-blur lg:-mx-10 lg:px-10">
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

// A live picture of the rail the current choices produce — the abstract lists
// above become the concrete thing the user actually looks at all day.
function RailPreview({ primary, utility }) {
  const Chip = ({ m }) => (
    <span className="flex flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] leading-none text-gray-300">
      <span className="flex h-5 items-center justify-center text-[17px] leading-none">
        {m.Icon ? <m.Icon size={17} /> : m.glyph}
      </span>
      <span className="whitespace-nowrap">{m.label}</span>
    </span>
  );
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-400">
        כך ייראה סרגל הניווט
      </div>
      <div className="flex items-center gap-2 overflow-x-auto rounded-xl bg-gray-900 p-2">
        {primary.map((m) => (
          <Chip key={m.key} m={m} />
        ))}
        <span className="mx-1 h-8 w-px shrink-0 bg-gray-700" aria-hidden="true" />
        {utility.map((m) => (
          <Chip key={m.key} m={m} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        בפועל הסרגל אנכי: הקבוצה הראשונה בראש המסך, השנייה צמודה לתחתיתו.
      </p>
    </div>
  );
}

function PanelHeading({ title, hint, count }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
          {count}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-gray-500">{hint}</p>
    </div>
  );
}

function GroupPanel({ title, hint, items, count, onReorder, onPlacement, emptyText }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <PanelHeading title={title} hint={hint} count={count} />
      <ReorderableList
        items={items.map((m) => ({ ...m, id: m.key }))}
        onReorder={onReorder}
        emptyText={emptyText}
        renderRow={(item, { handle }) => (
          <ModuleRow
            module={item}
            handle={handle}
            onPlacement={(p) => onPlacement(item.key, p)}
          />
        )}
      />
    </section>
  );
}

function ModuleRow({ module: m, handle, onPlacement }) {
  const Icon = m.Icon;
  const placement = placementOf(m);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
      {handle}
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gray-900 text-[17px] leading-none">
        {Icon ? <Icon size={18} /> : m.glyph}
      </span>
      <div className="min-w-[8rem] flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-gray-900">{m.label}</span>
          {m.pinned && (
            <span
              className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
              title="מודול קבוע — אפשר להזיז אותו בין הקבוצות, אך לא להסתיר"
            >
              קבוע
            </span>
          )}
        </div>
        <p className="truncate text-[12px] text-gray-500">{m.description}</p>
      </div>
      <PlacementControl
        value={placement}
        onChange={onPlacement}
        lockHidden={!!m.pinned}
        label={`מיקום של ${m.label} בתפריט`}
      />
    </div>
  );
}

// The explicit three-way placement control. It states where the module IS and
// offers every other destination in one click, which is what a plain
// visibility switch cannot do.
function PlacementControl({ value, onChange, lockHidden, label }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-lg border border-gray-200 bg-gray-100 p-0.5"
    >
      {PLACEMENTS.map((p) => {
        const active = value === p.value;
        const disabled = lockHidden && p.value === 'hidden';
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={disabled ? 'מודול קבוע — לא ניתן להסתרה' : undefined}
            onClick={() => !active && onChange(p.value)}
            className={`rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition ${
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : disabled
                  ? 'cursor-not-allowed text-gray-300'
                  : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
