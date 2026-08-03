import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api.js';
import PanelCard from '../../common/PanelCard.jsx';
import RichEditor from '../../../editor/RichEditor.jsx';
import { durationDisplay } from '../../../lib/duration.js';

// "תנאי עסקה מיוחדים (פילרים)" — the Deal card below פרטי הסיור.
//
// Visibility contract (approved):
//   • at least one saved filler → the card ALWAYS renders, no Hide;
//   • no fillers → hidden by default; the Tour-Details kebab reveals it
//     (ephemeral local state), and a Hide button returns it to the kebab.
// Fillers are structured deviations of THIS deal from the standard terms —
// they change what the confirmation email says. PRODUCT RULE: every
// customer-facing editable text here is headed "הערה ללקוח", so it can never
// be confused with internal notes.

const LABEL = 'block text-[12px] font-medium text-gray-600 mb-1';
const INPUT =
  'h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400';

const VALIDATION_TEXT = {
  invalid_mode: 'בחרו כיצד לטפל במדיניות הביטול.',
  policy_required: 'בחרו מדיניות מוגדרת מראש.',
  note_required: 'הערה ללקוח חסרה (עברית או English).',
  invalid_duration: 'משך הפעילות חייב להיות מספר שעות חיובי (עד 24).',
};

export default function DealFillersCard({ dealId, revealed, onHide, onVisibilityInfo, onDealChanged }) {
  const [state, setState] = useState(null); // GET /deal/:id/state payload
  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState(null);

  const load = useCallback(async () => {
    try {
      const s = await api.confirmationEmail.dealState(dealId);
      setState(s);
      setDraft(s.fillers);
    } catch {
      setState(null);
    }
  }, [dealId]);
  useEffect(() => {
    load();
  }, [load]);

  const hasSaved = !!state?.hasFillers;
  useEffect(() => {
    onVisibilityInfo?.(hasSaved);
  }, [hasSaved, onVisibilityInfo]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(state?.fillers || []),
    [draft, state],
  );

  if (!state) return null;
  if (!hasSaved && !revealed) return null;

  const kinds = state.meta.fillerKinds;
  const active = (kind) => draft.some((f) => f.kind === kind);
  const fillerOf = (kind) => draft.find((f) => f.kind === kind);
  const patchFiller = (kind, patch) =>
    setDraft((cur) => cur.map((f) => (f.kind === kind ? { ...f, ...patch } : f)));

  function toggleKind(kind) {
    setProblems(null);
    if (active(kind)) {
      setDraft((cur) => cur.filter((f) => f.kind !== kind));
      return;
    }
    const seed =
      kind === 'cancellation_policy'
        ? { kind, mode: 'default' }
        : kind === 'activity_duration'
          ? { kind, durationHours: state.durationInfo.canonicalHours }
          : kind === 'new_guide'
            ? {
              kind,
              noteHe: `<p>${state.meta.newGuideDefaultNote.he}</p>`,
              noteEn: `<p>${state.meta.newGuideDefaultNote.en}</p>`,
            }
            : { kind };
    setDraft((cur) => [...cur, seed]);
  }

  async function save() {
    setBusy(true);
    setProblems(null);
    try {
      await api.confirmationEmail.saveDealState(dealId, { fillers: draft });
      await load();
      onDealChanged?.();
    } catch (e) {
      if (e.payload?.error === 'invalid_fillers') setProblems(e.payload.problems);
      else alert('שגיאה בשמירה: ' + (e.payload?.error || e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelCard
      variant="panel"
      title="תנאי עסקה מיוחדים (פילרים)"
      action={
        !hasSaved && (
          <button
            type="button"
            onClick={onHide}
            className="text-[12px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1"
          >
            הסתר
          </button>
        )
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-[13px] font-medium text-gray-700 mb-2">איזה תנאים של העסקה השתנו?</div>
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => toggleKind(k.kind)}
                className={`rounded-full px-3 py-1 text-[12px] font-medium border transition ${
                  active(k.kind)
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {k.labelHe}
              </button>
            ))}
          </div>
        </div>

        {active('cancellation_policy') && (
          <CancellationEditor
            filler={fillerOf('cancellation_policy')}
            policies={state.policies}
            onChange={(p) => patchFiller('cancellation_policy', p)}
          />
        )}
        {active('activity_duration') && (
          <DurationEditor
            filler={fillerOf('activity_duration')}
            durationInfo={state.durationInfo}
            onChange={(p) => patchFiller('activity_duration', p)}
          />
        )}
        {active('new_guide') && (
          <FillerSection title="מדריך חדש">
            <CustomerNote filler={fillerOf('new_guide')} onChange={(p) => patchFiller('new_guide', p)} />
          </FillerSection>
        )}
        {active('other_note') && (
          <FillerSection title="הערה נוספת ללקוח">
            <CustomerNote filler={fillerOf('other_note')} onChange={(p) => patchFiller('other_note', p)} />
          </FillerSection>
        )}

        {problems?.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 space-y-0.5">
            {problems.map((p, i) => (
              <div key={i}>
                {kinds.find((k) => k.kind === p.kind)?.labelHe || p.kind}:{' '}
                {p.errors.map((c) => VALIDATION_TEXT[c] || c).join(' ')}
              </div>
            ))}
          </div>
        )}

        {(dirty || busy) && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמור'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(state.fillers);
                setProblems(null);
              }}
              disabled={busy}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
            >
              ביטול
            </button>
          </div>
        )}
      </div>
    </PanelCard>
  );
}

function FillerSection({ title, children }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-3">
      <div className="text-[13px] font-semibold text-gray-800">{title}</div>
      {children}
    </div>
  );
}

// The ONE customer-facing note editor — always headed "הערה ללקוח". The panel
// is ~460px wide, so the two languages stack (side-by-side is a settings-screen
// luxury, not a panel one).
function CustomerNote({ filler, onChange, optional = false }) {
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold text-gray-700">
        הערה ללקוח{optional ? ' (אופציונלי)' : ''}
      </div>
      <div>
        <span className={LABEL}>עברית</span>
        <RichEditor
          value={filler?.noteHe || ''}
          onChange={(v) => onChange({ noteHe: v })}
          ariaLabel="הערה ללקוח — עברית"
          minContentHeight={70}
        />
      </div>
      <div>
        <span className={LABEL}>English</span>
        <div dir="ltr">
          <RichEditor
            value={filler?.noteEn || ''}
            onChange={(v) => onChange({ noteEn: v })}
            ariaLabel="Customer note — English"
            minContentHeight={70}
            placeholder="Write here..."
          />
        </div>
      </div>
    </div>
  );
}

function CancellationEditor({ filler, policies, onChange }) {
  const mode = filler?.mode || 'default';
  const OPTIONS = [
    { value: 'default', label: 'מדיניות ברירת המחדל' },
    { value: 'policy', label: 'מדיניות מוגדרת מראש' },
    { value: 'override', label: 'נוסח מותאם לעסקה זו' },
  ];
  return (
    <FillerSection title="מדיניות ביטול">
      <div className="space-y-1.5">
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-[13px] text-gray-800">
            <input
              type="radio"
              name="cancel-mode"
              checked={mode === o.value}
              onChange={() => onChange({ mode: o.value })}
            />
            {o.label}
          </label>
        ))}
      </div>
      {mode === 'policy' && (
        <div>
          <span className={LABEL}>בחרו מדיניות</span>
          <select
            value={filler?.policyId || ''}
            onChange={(e) => onChange({ policyId: e.target.value })}
            className={`${INPUT} w-full`}
          >
            <option value="">— בחרו —</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.internalName}
              </option>
            ))}
          </select>
          {policies.length === 0 && (
            <p className="text-[11px] text-amber-600 mt-1">
              אין מדיניות מוגדרת מראש — צרו אחת בספריית התוכן המשותף (״מדיניות ביטול — מייל אישור״).
            </p>
          )}
        </div>
      )}
      {mode === 'override' && <CustomerNote filler={filler} onChange={onChange} />}
      <p className="text-[11px] text-gray-400">הבחירה מחליפה לגמרי את בלוק מדיניות הביטול במייל האישור.</p>
    </FillerSection>
  );
}

function DurationEditor({ filler, durationInfo, onChange }) {
  return (
    <FillerSection title="משך הפעילות">
      <div className="text-[12px] text-gray-500">
        המשך הרגיל: <span className="font-medium text-gray-700">{durationDisplay(durationInfo.canonicalHours)}</span>
      </div>
      <label className="block max-w-[11rem]">
        <span className={LABEL}>משך חדש (שעות)</span>
        <input
          type="number"
          step="0.5"
          min="0.5"
          max="24"
          dir="ltr"
          value={filler?.durationHours ?? ''}
          onChange={(e) => onChange({ durationHours: e.target.value === '' ? null : Number(e.target.value) })}
          className={`${INPUT} w-full`}
        />
      </label>
      <p className="text-[11px] text-gray-400">
        המשך החדש נשמר על העסקה ומחליף את המשך הרגיל במייל האישור.
      </p>
      <CustomerNote filler={filler} onChange={onChange} optional />
    </FillerSection>
  );
}
