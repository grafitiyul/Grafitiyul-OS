import { useCallback, useEffect, useMemo, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import TourSlotPickerDialog from '../tours/TourSlotPickerDialog.jsx';
import PriceBuilderDialog from './PriceBuilderDialog.jsx';
import { api } from '../../lib/api.js';
import { ACTIVITY_TYPE_LABELS, ACTIVITY_OPTION_ON } from './config.js';

// "שנה סוג פעילות" — the conversion workspace.
//
// Changing what a deal IS moves seats on real tours, changes what the customer
// is booked for, and can leave money on the wrong side of the balance. The
// operator gets to see ALL of that before committing: the server's preview is
// the single source of what will happen (this component never re-derives a
// consequence), and the confirm button is disabled until the server says the
// conversion is possible.
//
// Three steps, each visible at once rather than hidden behind a wizard — the
// operator is making one decision and needs the whole picture to make it:
//   1. where the deal is now
//   2. what it should become (+ the slot / organization decisions that implies)
//   3. the money, the plan, and what still blocks it
//
// The Builder is REUSED, not rebuilt: "ערוך מחיר" opens the canonical
// PriceBuilderDialog and the preview refetches on close, so the Builder stays
// the only writer of product and price.

const ACTIVITY_TYPES = ['group', 'private', 'business'];

const BLOCKER_HE = {
  won_requirements_missing: 'חסרים פרטים שנדרשים לסוג הפעילות הנבחר',
  tour_slot_required: 'יש לבחור מועד סיור קבוצתי',
  tour_slot_invalid: 'מועד הסיור שנבחר אינו סיור קבוצתי',
  tour_slot_not_scheduled: 'מועד הסיור שנבחר אינו פעיל',
  tour_full: 'הסיור הקבוצתי מלא',
  organization_choice_required: 'יש להחליט מה קורה עם הארגון המקושר',
};

const ERROR_HE = {
  same_activity_type: 'הדיל כבר בסוג הפעילות הזה.',
  conversion_op_id_conflict: 'הפעולה כבר בוצעה על דיל אחר.',
  conversion_op_id_required: 'שגיאה פנימית: חסר מזהה פעולה.',
  not_found: 'הדיל לא נמצא.',
  ...BLOCKER_HE,
};

const money = (minor, currency = 'ILS') => {
  const n = (Number(minor) || 0) / 100;
  const sign = currency === 'ILS' ? '₪' : `${currency} `;
  return `${sign}${n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const fmtWhen = (t) => {
  if (!t?.date) return 'ללא מועד';
  const [y, m, d] = String(t.date).split('-');
  return `${d}.${m}.${y}${t.startTime ? ` · ${t.startTime}` : ''}`;
};

// A stable operation identity per OPERATOR INTENT. Minted once when the dialog
// opens and reused across every retry, so a double click, a refresh mid-request
// or a flaky network can never convert twice — the server's unique index on
// Deal.conversionOpId is what actually enforces it, and this is its client half.
const mintOpId = () =>
  (globalThis.crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function ActivityConversionDialog({ open, deal, onClose, onDone }) {
  const [target, setTarget] = useState(null);
  const [tourEventId, setTourEventId] = useState(null);
  const [orgChoice, setOrgChoice] = useState(null);
  const [allowOverbook, setAllowOverbook] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [opId, setOpId] = useState(null);
  const [sendConfirmation, setSendConfirmation] = useState(false);

  // Every choice is re-armed on open — a previous conversion's target, slot or
  // organization decision must never leak into the next one.
  useEffect(() => {
    if (!open) return;
    setTarget(null);
    setTourEventId(null);
    setOrgChoice(null);
    setAllowOverbook(false);
    setPreview(null);
    setError(null);
    setSendConfirmation(false);
    setOpId(mintOpId());
  }, [open, deal?.id]);

  const loadPreview = useCallback(async () => {
    if (!open || !deal?.id || !target) {
      setPreview(null);
      return;
    }
    setLoading(true);
    try {
      const p = await api.deals.conversionPreview(deal.id, {
        target,
        tourEventId: tourEventId || undefined,
        allowOverbook: allowOverbook || undefined,
        organizationChoice: orgChoice || undefined,
      });
      setPreview(p);
      setError(null);
    } catch (e) {
      setPreview(null);
      setError(ERROR_HE[e.payload?.error] || e.payload?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [open, deal?.id, target, tourEventId, allowOverbook, orgChoice]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const hasOrg = !!deal?.organization;
  const orgDecisionNeeded = hasOrg && target && target !== 'business';

  // The slot the server has CONFIRMED for this preview — never a locally
  // assembled one, so capacity and timing on screen are always the server's.
  const chosenSlot = preview?.target?.tourEvent || null;
  const blockers = preview?.blockers || [];
  const capacityBlocked = blockers.some((b) => b.code === 'tour_full');
  const canConvert = !!preview?.canConvert && !saving;

  const delta = useMemo(() => {
    if (!preview?.money) return null;
    const { totalMinor, paidMinor, balanceMinor, currency } = preview.money;
    return { totalMinor, paidMinor, balanceMinor, currency, overpaid: balanceMinor < 0 };
  }, [preview]);

  async function convert() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.deals.convert(deal.id, {
        targetActivityType: target,
        tourEventId: tourEventId || undefined,
        allowOverbook,
        organizationChoice: orgChoice || undefined,
        opId,
      });
      onDone?.(res, { sendConfirmation });
      onClose?.();
    } catch (e) {
      const code = e.payload?.error;
      if (code === 'tour_full' && !allowOverbook) {
        // The EXISTING overbook rule, surfaced the same way every other tour
        // action surfaces it — never a new policy invented here.
        const { capacity, activeSeats, requested } = e.payload;
        if (window.confirm(
          `הסיור מלא: קיבולת ${capacity}, תפוסה ${activeSeats}, מבוקש ${requested}.\n`
          + 'לשבץ בכל זאת (מעל הקיבולת)?',
        )) {
          setAllowOverbook(true);
          setSaving(false);
          return;
        }
        setSaving(false);
        return;
      }
      setError(ERROR_HE[code] || code || e.message);
      setSaving(false);
    }
  }

  if (!deal) return null;

  return (
    <>
      <Dialog
        open={open}
        onClose={saving ? undefined : onClose}
        title="שינוי סוג פעילות"
        size="xl"
        ariaLabel="שינוי סוג פעילות לדיל"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-gray-400">
              התשלומים, המסמכים החשבונאיים והיסטוריית הדיל נשמרים במלואם.
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
              <button
                type="button"
                onClick={convert}
                disabled={!canConvert}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'מבצע…' : 'בצע שינוי'}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-5" dir="rtl">
          {/* ── 1. where the deal is now ───────────────────────────────── */}
          <section>
            <SectionTitle>המצב הנוכחי</SectionTitle>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Fact label="סוג פעילות">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold ${ACTIVITY_OPTION_ON[deal.activityType] || 'bg-gray-100 text-gray-600'}`}>
                    {ACTIVITY_TYPE_LABELS[deal.activityType] || 'ללא סוג'}
                  </span>
                </Fact>
                <Fact label="סיור משובץ">
                  {preview?.current?.tourEvent ? fmtWhen(preview.current.tourEvent) : '—'}
                </Fact>
                <Fact label="משתתפים">{preview?.current?.participants ?? deal.participants ?? '—'}</Fact>
                <Fact label="ארגון">{deal.organization?.name || '—'}</Fact>
                <Fact label="שולם">{delta ? money(delta.paidMinor, delta.currency) : '—'}</Fact>
                <Fact label="סכום הדיל">{delta ? money(delta.totalMinor, delta.currency) : '—'}</Fact>
              </dl>
            </div>
          </section>

          {/* ── 2. what it becomes ─────────────────────────────────────── */}
          <section>
            <SectionTitle>סוג הפעילות החדש</SectionTitle>
            <div className="flex gap-2">
              {ACTIVITY_TYPES.map((v) => {
                const isCurrent = deal.activityType === v;
                const on = target === v;
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={isCurrent || saving}
                    onClick={() => { setTarget(v); setTourEventId(null); setAllowOverbook(false); }}
                    title={isCurrent ? 'זהו סוג הפעילות הנוכחי' : undefined}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      on ? ACTIVITY_OPTION_ON[v] : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    } disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white`}
                  >
                    {ACTIVITY_TYPE_LABELS[v]}
                  </button>
                );
              })}
            </div>
          </section>

          {target && (
            <>
              {/* the slot decision — never guessed */}
              {preview?.requires?.slotSelection && (
                <section>
                  <SectionTitle>הסיור הקבוצתי</SectionTitle>
                  <div className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
                    <div className="min-w-0 flex-1 text-sm">
                      {chosenSlot ? (
                        <>
                          <div className="font-semibold text-gray-800">{fmtWhen(chosenSlot)}</div>
                          {preview?.capacity?.capacity != null && (
                            <div className={`text-[12px] ${preview.capacity.fits ? 'text-gray-500' : 'text-red-600'}`}>
                              תפוסה {preview.capacity.activeSeats}/{preview.capacity.capacity} · נדרשים {preview.capacity.requested} מקומות
                              {!preview.capacity.fits && ' — אין מספיק מקום'}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-500">טרם נבחר מועד סיור</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSlotPickerOpen(true)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      {chosenSlot ? 'החלף מועד' : 'בחר מועד'}
                    </button>
                  </div>
                </section>
              )}

              {/* the organization decision — explicit, never automatic */}
              {orgDecisionNeeded && (
                <section>
                  <SectionTitle>הארגון המקושר</SectionTitle>
                  <p className="mb-2 text-[12px] text-gray-500">
                    לדיל מקושר הארגון <b>{deal.organization?.name}</b>. ארגון הוא מי שמשלם, לא מה שמתבצע —
                    לכן אין הסרה אוטומטית. יש להחליט:
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ChoiceCard
                      selected={orgChoice === 'keep'}
                      onClick={() => setOrgChoice('keep')}
                      title="להשאיר את הארגון מקושר"
                      body="הפעילות תסווג כפי שנבחר, והארגון יישאר על הדיל לצורך חשבונית, דוחות והיסטוריה. שילוב מכוון ולגיטימי."
                    />
                    <ChoiceCard
                      selected={orgChoice === 'remove'}
                      onClick={() => setOrgChoice('remove')}
                      title="להסיר את הארגון מהדיל"
                      body="הקישור לארגון (וגם לסניף, אם קיים) יוסר. הארגון עצמו וכל הדילים האחרים שלו לא מושפעים."
                    />
                  </div>
                </section>
              )}

              {/* the money — shown, never acted on */}
              <section>
                <SectionTitle>
                  <span className="flex items-center gap-2">
                    המצב הכספי
                    <button
                      type="button"
                      onClick={() => setBuilderOpen(true)}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      ערוך מחיר
                    </button>
                  </span>
                </SectionTitle>
                {delta && (
                  <div className="rounded-xl border border-gray-200 p-3">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <Money label="שולם" value={money(delta.paidMinor, delta.currency)} />
                      <Money label="סכום הדיל" value={money(delta.totalMinor, delta.currency)} />
                      <Money
                        label={delta.overpaid ? 'יתרת זכות' : 'יתרה לתשלום'}
                        value={money(Math.abs(delta.balanceMinor), delta.currency)}
                        tone={delta.overpaid ? 'credit' : delta.balanceMinor > 0 ? 'due' : 'ok'}
                      />
                    </div>
                    {delta.overpaid && (
                      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                        הסכום ששולם גבוה מסכום הדיל. <b>לא יופק זיכוי ולא יבוצע החזר אוטומטית</b> —
                        תיפתח משימת טיפול לקבלת החלטה לפי כללי החשבונאות.
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-gray-400">
                      אם המחיר החדש שונה, כדאי לעדכן את המחירון לפני הביצוע — היתרה מחושבת מול מה שכבר שולם,
                      אף פעם לא מאפס.
                    </p>
                  </div>
                )}
              </section>

              {/* what will happen + what blocks it */}
              <section>
                <SectionTitle>מה יקרה</SectionTitle>
                {loading && <div className="text-sm text-gray-500">מחשב…</div>}
                {!loading && preview && (
                  <>
                    <ol className="list-decimal space-y-1 rounded-xl border border-gray-200 p-3 pr-7 text-[13px] text-gray-700">
                      {preview.plan.map((step, i) => <li key={i}>{step}</li>)}
                    </ol>
                    {preview.warnings?.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {preview.warnings.map((w, i) => (
                          <li key={i} className="rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] text-blue-800">
                            {w.messageHe}
                          </li>
                        ))}
                      </ul>
                    )}
                    {blockers.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {blockers.map((b, i) => (
                          <li key={i} className="rounded-lg bg-red-50 px-3 py-1.5 text-[12px] text-red-700">
                            {BLOCKER_HE[b.code] || b.code}
                            {b.fields?.length ? `: ${b.fields.map((f) => f.labelHe).join(', ')}` : ''}
                            {b.code === 'tour_full' && b.capacity != null
                              ? ` (קיבולת ${b.capacity}, תפוסה ${b.activeSeats}, נדרשים ${b.requested})`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>

              {/* the customer message — offered, never automatic */}
              <section>
                <label className="flex items-start gap-2 rounded-xl border border-gray-200 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={sendConfirmation}
                    onChange={(e) => setSendConfirmation(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold text-gray-800">שלח אישור מעודכן ללקוח</span>
                    <span className="block text-[12px] text-gray-500">
                      ייפתח מייל האישור עם הפרטים החדשים לאישור לפני שליחה. אישורים קודמים נשמרים כהיסטוריה.
                    </span>
                  </span>
                </label>
              </section>
            </>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          {capacityBlocked && (
            <p className="text-[12px] text-gray-500">
              אפשר לבחור מועד אחר, או לאשר שיבוץ מעל הקיבולת בעת הביצוע.
            </p>
          )}
        </div>
      </Dialog>

      <TourSlotPickerDialog
        open={slotPickerOpen}
        deal={deal}
        currentTourEventId={preview?.current?.tourEvent?.id || null}
        onClose={() => setSlotPickerOpen(false)}
        onPick={(id, overbook) => {
          setTourEventId(id);
          setAllowOverbook(!!overbook);
          setSlotPickerOpen(false);
          // Display comes from the PREVIEW refetch this triggers, never from a
          // locally assembled slot — the dialog only ever shows a slot the
          // server has confirmed, capacity included.
        }}
      />

      {/* The canonical Builder — the ONE writer of product and price. The
          preview refetches on close so the money picture is never stale. */}
      <PriceBuilderDialog
        open={builderOpen}
        deal={deal}
        onClose={() => setBuilderOpen(false)}
        onSaved={() => { setBuilderOpen(false); loadPreview(); }}
      />
    </>
  );
}

function SectionTitle({ children }) {
  return <h3 className="mb-2 text-[12px] font-semibold text-gray-500">{children}</h3>;
}

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className="truncate text-[13px] font-medium text-gray-800">{children}</dd>
    </div>
  );
}

const MONEY_TONE = {
  credit: 'text-amber-700',
  due: 'text-red-600',
  ok: 'text-emerald-700',
};

function Money({ label, value, tone }) {
  return (
    <div>
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className={`text-[17px] font-semibold ${MONEY_TONE[tone] || 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

function ChoiceCard({ selected, onClick, title, body }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-right transition ${
        selected ? 'border-gray-800 bg-gray-50 ring-1 ring-gray-800' : 'border-gray-300 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      <div className="mt-0.5 text-[12px] text-gray-500">{body}</div>
    </button>
  );
}
