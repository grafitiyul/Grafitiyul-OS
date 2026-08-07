import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import MergeCandidateSearch from './MergeCandidateSearch.jsx';
import MergeComparison from './MergeComparison.jsx';
import MergeDecisions from './MergeDecisions.jsx';
import MergeFinalReview from './MergeFinalReview.jsx';
import { money, BLOCKER_HE } from './mergeFormat.js';

// "איחוד דילים" — the merge workspace.
//
// Merging is the most destructive thing an operator can do to a deal short of
// deleting it, so the whole flow is built around one promise: NOTHING is
// written until the final button. The server's preview is a pure read and is
// the single source of what will happen — this component never re-derives a
// consequence — and every decision simply refetches it.
//
// STAGED, not screen-replacing: the section pattern from the Open Tour
// registration modal (GroupRegistrationModal). The active section expands;
// completed ones collapse to a summary and reopen on click. An operator can go
// back and change any earlier answer at any point before confirming, and the
// preview recomputes underneath them.
//
//   1. בחירת הדיל השני   — canonical global search, deal rows with price
//   2. השוואה             — side by side, differences highlighted
//   3. איזה דיל נשאר      — the survivor decision, which everything else follows
//   4. החלטות             — only the GENUINE conflicts (commercial, participants,
//                            status, operational, fields, primary contact, tasks)
//   5. סקירה ואישור       — the whole outcome, including what happens to the other deal

const STEPS = [
  { key: 'pick', title: 'בחירת הדיל השני' },
  { key: 'compare', title: 'השוואה בין הדילים' },
  { key: 'survivor', title: 'איזה דיל נשאר' },
  { key: 'decisions', title: 'החלטות' },
  { key: 'review', title: 'סקירה ואישור' },
];

const ERROR_HE = {
  two_deals_required: 'יש לבחור שני דילים.',
  same_deal: 'לא ניתן לאחד דיל עם עצמו.',
  invalid_survivor: 'הדיל שנבחר להישאר אינו אחד משני הדילים.',
  not_found: 'אחד הדילים לא נמצא.',
  merge_op_id_required: 'שגיאה פנימית: חסר מזהה פעולה.',
  other_deal_required: 'יש לבחור דיל שני.',
  merge_blocked: 'יש החלטות שטרם הושלמו.',
  deal_retired_by_merge: 'הדיל הזה כבר אוחד לתוך דיל אחר.',
};

// A stable operation identity per OPERATOR INTENT. Minted once when the dialog
// opens and reused across every retry, so a double click, a refresh mid-request
// or a flaky network can never merge twice — the server's unique index on
// DealMerge.opId is what actually enforces it, and this is its client half.
const mintOpId = () =>
  (globalThis.crypto?.randomUUID?.() || `merge-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function DealMergeWizard({ open, deal, onClose, onDone }) {
  const [step, setStep] = useState('pick');
  const [other, setOther] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [opId, setOpId] = useState(null);
  const reqSeq = useRef(0);

  // Every choice is re-armed on open — a previous merge's candidate, survivor
  // or conflict answers must never leak into the next one.
  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setOther(null);
    setDecisions({});
    setPreview(null);
    setError(null);
    setSaving(false);
    setOpId(mintOpId());
  }, [open, deal?.id]);

  const loadPreview = useCallback(async () => {
    if (!open || !deal?.id || !other?.id) {
      setPreview(null);
      return;
    }
    // Out-of-order guard: decisions change fast (checkbox lists), and a slow
    // earlier response must never overwrite a newer one.
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const p = await api.deals.mergePreview(deal.id, { otherDealId: other.id, decisions });
      if (seq !== reqSeq.current) return;
      setPreview(p);
      setError(null);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setPreview(null);
      setError(ERROR_HE[e.payload?.error] || e.payload?.error || e.message);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [open, deal?.id, other?.id, decisions]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const patch = useCallback((next) => setDecisions((d) => ({ ...d, ...next })), []);

  const blockers = preview?.blockers || [];
  const canMerge = !!preview?.canMerge && !saving && !loading;

  // Which sections are answered — drives the collapsed summaries and whether
  // "המשך" is available. Derived from the SERVER's preview, never from local
  // state, so the wizard can never think a decision is made that the server
  // still considers open.
  const done = useMemo(() => ({
    pick: !!other,
    compare: !!preview,
    survivor: !!decisions.survivorDealId,
    decisions: !!preview && !blockers.length,
    review: false,
  }), [other, preview, decisions.survivorDealId, blockers.length]);

  async function confirmMerge() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.deals.merge(deal.id, {
        otherDealId: other.id,
        decisions,
        opId,
      });
      onDone?.(res);
      onClose?.();
    } catch (e) {
      const code = e.payload?.error;
      if (code === 'merge_blocked') {
        // The server refused on a re-evaluated blocker — surface it and send
        // the operator back to the decisions rather than failing opaquely.
        setStep('decisions');
        await loadPreview();
      }
      setError(ERROR_HE[code] || code || e.message);
      setSaving(false);
    }
  }

  if (!deal) return null;

  const survivorNo = preview?.survivor?.orderNo;
  const retiredNo = preview?.other?.orderNo;

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      title="איחוד דילים"
      size="xl"
      ariaLabel="איחוד שני דילים לדיל אחד"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-400">
            שום דבר לא נשמר עד הלחיצה על "אחד דילים". סגירה עכשיו לא משנה כלום בשני הדילים.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              ביטול
            </button>
            {step !== 'review' ? (
              <button
                type="button"
                onClick={() => setStep(nextStep(step))}
                disabled={!canAdvance(step, done)}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                המשך
              </button>
            ) : (
              <button
                type="button"
                onClick={confirmMerge}
                disabled={!canMerge}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'מאחד…' : 'אחד דילים'}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-3" dir="rtl">
        <Section
          index={1}
          title={STEPS[0].title}
          active={step === 'pick'}
          done={done.pick}
          summary={other ? `דיל #${other.orderNo} — ${other.title}` : null}
          onOpen={() => setStep('pick')}
        >
          <MergeCandidateSearch
            currentDeal={deal}
            selected={other}
            onSelect={(row) => {
              setOther(row);
              // A new candidate invalidates every answer that was about the
              // previous pair — never carried over silently.
              setDecisions({ survivorDealId: deal.id });
              setStep('compare');
            }}
          />
        </Section>

        <Section
          index={2}
          title={STEPS[1].title}
          active={step === 'compare'}
          done={done.compare}
          summary={preview ? `#${survivorNo} מול #${retiredNo}` : null}
          onOpen={() => other && setStep('compare')}
          disabled={!other}
        >
          <MergeComparison preview={preview} loading={loading} />
        </Section>

        <Section
          index={3}
          title={STEPS[2].title}
          active={step === 'survivor'}
          done={done.survivor}
          summary={
            decisions.survivorDealId && preview
              ? `נשאר דיל #${survivorNo} · נסגר דיל #${retiredNo}`
              : null
          }
          onOpen={() => preview && setStep('survivor')}
          disabled={!preview}
        >
          <SurvivorChoice
            deal={deal}
            other={other}
            preview={preview}
            value={decisions.survivorDealId || deal.id}
            onChange={(id) => patch({ survivorDealId: id, primaryContactId: undefined })}
          />
        </Section>

        <Section
          index={4}
          title={STEPS[3].title}
          active={step === 'decisions'}
          done={done.decisions}
          summary={
            preview
              ? blockers.length
                ? `${blockers.length} החלטות פתוחות`
                : 'כל ההחלטות הושלמו'
              : null
          }
          onOpen={() => preview && setStep('decisions')}
          disabled={!preview}
        >
          <MergeDecisions preview={preview} decisions={decisions} onPatch={patch} loading={loading} />
        </Section>

        <Section
          index={5}
          title={STEPS[4].title}
          active={step === 'review'}
          done={false}
          summary={null}
          onOpen={() => preview && setStep('review')}
          disabled={!preview}
        >
          <MergeFinalReview preview={preview} loading={loading} />
        </Section>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      </div>
    </Dialog>
  );
}

function nextStep(step) {
  const i = STEPS.findIndex((s) => s.key === step);
  return STEPS[Math.min(i + 1, STEPS.length - 1)].key;
}

function canAdvance(step, done) {
  if (step === 'pick') return done.pick;
  if (step === 'compare') return done.compare;
  if (step === 'survivor') return done.survivor;
  if (step === 'decisions') return done.decisions;
  return true;
}

// The same collapsible-section language as the Open Tour registration modal —
// deliberately identical, so an operator recognises the interaction rather than
// learning a second staged flow.
function Section({ index, title, active, done, summary, onOpen, disabled, children }) {
  return (
    <section className={`rounded-xl border ${active ? 'border-blue-300 shadow-sm' : 'border-gray-200'} ${disabled ? 'opacity-50' : ''}`}>
      <button
        type="button"
        onClick={disabled ? undefined : onOpen}
        disabled={disabled}
        className={`flex w-full items-center gap-3 px-4 py-3 text-right ${active ? 'bg-blue-50/60' : 'hover:bg-gray-50'} disabled:cursor-not-allowed`}
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
          {done ? '✓' : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-gray-900">{title}</span>
          {!active && summary && <span className="block truncate text-[12.5px] text-gray-500">{summary}</span>}
        </span>
        {!active && !disabled && <span className="text-[12px] text-blue-600">{done ? 'עריכה' : 'פתח'}</span>}
      </button>
      {active && <div className="border-t border-gray-100 p-4">{children}</div>}
    </section>
  );
}

// The survivor decision, and why it matters — stated plainly, because it is the
// one choice everything downstream follows from. A recommendation is offered
// (never auto-applied): the deal that carries more of the real transaction.
function SurvivorChoice({ deal, other, preview, value, onChange }) {
  if (!preview) return null;
  const sides = [
    { id: deal.id, side: preview.survivorDealId === deal.id ? preview.survivor : preview.other },
    { id: other.id, side: preview.survivorDealId === other.id ? preview.survivor : preview.other },
  ];
  const recommended = recommendSurvivor(sides);

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-gray-600">
        הדיל שנשאר שומר על <b>מספר ההזמנה שלו</b>, על איש הקשר הראשי שלו ועל היותו הדיל הפעיל.
        הדיל השני יסומן כמאוחד, ימשיך להיות נגיש וניתן לחיפוש לפי המספר הישן — אך לא יופיע יותר כדיל עצמאי.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {sides.map(({ id, side }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`rounded-xl border p-3 text-right transition ${
              value === id ? 'border-gray-800 bg-gray-50 ring-1 ring-gray-800' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900">דיל #{side.orderNo}</span>
              {recommended === id && (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">מומלץ</span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-gray-500">{side.title}</div>
            <dl className="mt-2 space-y-0.5 text-[12px] text-gray-600">
              <Row label="סטטוס" value={String(side.status || '').toUpperCase()} />
              <Row label="סכום" value={money(side.valueMinor, side.currency)} />
              <Row label="משתתפים" value={side.participants ?? '—'} />
              <Row label="אנשי קשר" value={side.contactCount} />
              <Row label="הערות והיסטוריה" value={side.notesCount} />
            </dl>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">
        ההמלצה מבוססת על כמות ההיסטוריה והתוכן המסחרי בלבד — ההחלטה שלך.
      </p>
    </div>
  );
}

// A recommendation, never a decision. Scored on how much of the real
// transaction each deal actually carries; ties fall to the first side, which is
// the deal the operator opened the wizard from.
function recommendSurvivor(sides) {
  const score = (s) =>
    (s.status === 'won' ? 4 : 0)
    + (Number(s.valueMinor) > 0 ? 2 : 0)
    + (s.hasBuilder ? 2 : 0)
    + Math.min(3, Math.round((s.notesCount || 0) / 5))
    + Math.min(2, s.contactCount || 0);
  const [a, b] = sides;
  return score(b.side) > score(a.side) ? b.id : a.id;
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-700">{value}</dd>
    </div>
  );
}
