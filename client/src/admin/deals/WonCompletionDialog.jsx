import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { DateField, TimeField } from '../common/pickers/DateTimeFields.jsx';
import { api } from '../../lib/api.js';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, TOUR_LANGS } from './config.js';
import { productContextFor, locationContextFor, priceContextFor } from './tourContext.js';
import PriceBuilderDialog from './PriceBuilderDialog.jsx';

// "השלמה וסגירה כ-WON" — the WON readiness dialog as a real form.
//
// It used to be a dead end: it listed what was missing, the operator closed it,
// edited the deal somewhere else, and pressed WON again. Everything it listed
// was already editable — just not here. So it fills in here, and WON continues
// in the same action.
//
// ── What it does NOT own ──────────────────────────────────────────────────────
// The checklist  — the server's canonical gate answers it (POST
//                  /deals/:id/won-readiness runs the SAME resolveActivityType +
//                  wonGate pair the transition runs). There is no second
//                  checklist anywhere in this file.
// The write      — ONE canonical PUT /deals/:id carrying the completed fields
//                  AND status:'won'. The server already merges a save into the
//                  gate check and applies both in one transaction, so "save
//                  then win" is atomic by construction: if WON is refused,
//                  nothing was saved; if it succeeds, both happened.
// WON behaviour  — TourEvent, Booking, registration, calendar, confirmation
//                  email, review items, automations, the WON actor: all of it
//                  stays where it is. This dialog changes WHO fills the fields,
//                  not what winning a deal does.
// The product    — Deal.productId is written by the Price Builder and by
//                  nothing else (project rule). A missing product therefore
//                  opens the REAL Builder from inside this flow rather than a
//                  weaker picker beside it.
//
// ── Live reactivity ───────────────────────────────────────────────────────────
// Every change re-asks the server what WON would now require. Choosing קבוצתי
// stops demanding the seven planning fields and starts demanding a slot;
// choosing פרטי does the reverse. The form always shows the real requirement
// set, because it never computes one.

const LANG_OPTIONS = TOUR_LANGS.map((l) => ({ value: l.key, label: l.label }));

// Fields this form can complete in place. Anything the gate reports that is not
// here is shown as an explicit, named blocker with the action that resolves it
// — never silently omitted, which would read as "nothing else is wrong".
const INLINE_FIELDS = new Set([
  'activityType', 'tourDate', 'tourTime', 'participants', 'tourLanguage', 'locationId',
]);
// Resolved BY choosing a city (locationContextFor), so it is never its own
// control — a variant is the product×city pair, not an independent choice.
const DERIVED_FIELDS = new Set(['productVariantId']);

const FIELD_BOX = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full';

function FieldBox({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-gray-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
    </label>
  );
}

const ASSUMED_REASON_HE = {
  group_slot_selected: 'נבחר סיור קבוצתי',
  organization_linked: 'הדיל משויך לארגון',
  default_private: 'ברירת מחדל — לקוח פרטי',
};

const ERROR_HE = {
  invalid_activity_type: 'סוג הפעילות שנבחר אינו תקין.',
  conversion_required: 'לדיל כבר יש מצב תפעולי — שינוי סוג הפעילות נעשה דרך מסלול ההמרה.',
  group_tour_fields_locked: 'הדיל משובץ לסיור קבוצתי — הסיור הוא שקובע את פרטי התכנון.',
  tour_slot_invalid: 'הסיור שנבחר אינו תקין.',
  tour_slot_not_scheduled: 'הסיור שנבחר אינו פעיל.',
};

export default function WonCompletionDialog({
  open, deal, onClose, onWon, onNeedSlot, tourEventId = null, allowOverbook = false,
}) {
  // The draft — ONLY the gate's own fields, seeded from the deal. Narrow on
  // purpose: this must never touch a note, a task or any other unsaved edit
  // living on the deal workspace behind it.
  const [draft, setDraft] = useState({});
  const [variants, setVariants] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  // The deal as this dialog last read it. The workspace behind may refresh for
  // unrelated reasons; the form must not lose what the operator typed.
  const [live, setLive] = useState(deal);
  const seededFor = useRef(null);
  const probeSeq = useRef(0);
  const submitting = useRef(false);

  // Seed on the deal's IDENTITY, never on the refetched object — the workspace
  // behind this dialog refetches for reasons of its own, and a half-filled form
  // must survive every one of them (dialogInitGuard). The current deal is read
  // through a ref precisely so it is NOT a dependency.
  const dealRef = useRef(deal);
  dealRef.current = deal;
  useEffect(() => {
    const d = dealRef.current;
    if (!open || !d?.id || seededFor.current === d.id) return;
    seededFor.current = d.id;
    setLive(d);
    setDraft({
      activityType: d.activityType || '',
      tourDate: d.tourDate || '',
      tourTime: d.tourTime || '',
      participants: d.participants ?? '',
      tourLanguage: d.tourLanguage || '',
      locationId: d.locationId || '',
      productId: d.productId || '',
      productVariantId: d.productVariantId || '',
    });
    setError(null);
    setReadiness(null);
  }, [open, deal?.id]);

  useEffect(() => { if (!open) seededFor.current = null; }, [open]);

  // Catalogs. Locations are the city options; the product's variants decide
  // which cities are RECOMMENDED — the same two sources the deal's tour card
  // uses, so the dropdown here is the same dropdown.
  useEffect(() => {
    if (!open) return;
    api.locations.list().then(setAllLocations).catch(() => setAllLocations([]));
    api.activityTypes?.list?.().then(setActivityTypes).catch(() => setActivityTypes([]));
  }, [open]);

  useEffect(() => {
    if (!open || !draft.productId) { setVariants([]); return; }
    let cancelled = false;
    productContextFor(draft.productId)
      .then((c) => !cancelled && setVariants(c.variants))
      .catch(() => !cancelled && setVariants([]));
    return () => { cancelled = true; };
  }, [open, draft.productId]);

  // ── The checklist. Asked, never computed. ──────────────────────────────────
  const probe = useCallback(async (nextDraft) => {
    if (!deal?.id) return;
    const seq = ++probeSeq.current;
    setChecking(true);
    try {
      const r = await api.deals.wonReadiness(deal.id, { draft: nextDraft, tourEventId });
      if (probeSeq.current === seq) setReadiness(r);
    } catch {
      if (probeSeq.current === seq) setReadiness(null);
    } finally {
      if (probeSeq.current === seq) setChecking(false);
    }
  }, [deal?.id, tourEventId]);

  useEffect(() => {
    if (!open || !seededFor.current) return undefined;
    const t = setTimeout(() => probe(draft), 200);
    return () => clearTimeout(t);
  }, [open, draft, probe]);

  const set = (patch) => { setDraft((d) => ({ ...d, ...patch })); setError(null); };

  // Choosing a CITY resolves the product×city variant — the shared derivation,
  // not a local one.
  function chooseCity(locationId) {
    const c = locationContextFor(variants, locationId);
    set({ locationId: c.locationId, productVariantId: c.productVariantId });
  }

  const cityOptions = useMemo(() => {
    const recIds = new Set(variants.map((v) => v.location?.id || v.locationId).filter(Boolean));
    const recommended = variants
      .map((v) => ({ value: v.location?.id || v.locationId, label: v.location?.nameHe || '—' }))
      .filter((o) => o.value);
    const others = allLocations.filter((l) => !recIds.has(l.id)).map((l) => ({ value: l.id, label: l.nameHe }));
    return { recommended, others };
  }, [variants, allLocations]);

  const missing = readiness?.missing || [];
  const missingFields = new Set(missing.map((m) => m.field));
  const shows = (f) => missingFields.has(f) || (f === 'activityType' && readiness?.activityTypeAssumed);
  // Reported as missing, not completable here, and not merely derived.
  const blockers = missing.filter((m) => !INLINE_FIELDS.has(m.field) && !DERIVED_FIELDS.has(m.field));
  const productBlocked = missingFields.has('productId');
  const variantBlocked = missingFields.has('productVariantId') && !missingFields.has('locationId');

  const priceContext = useMemo(
    () => priceContextFor({
      productId: draft.productId,
      productVariantId: draft.productVariantId,
      participants: draft.participants,
      activityType: readiness?.activityType || draft.activityType,
      organizationTypeId: live?.organizationTypeId || live?.organization?.organizationTypeId,
      organizationSubtypeId: live?.organizationSubtypeId,
    }, activityTypes),
    [draft, readiness?.activityType, live, activityTypes],
  );

  // The completed fields, in the shape the canonical Deal writer takes. Only
  // fields the operator actually changed travel — an untouched value is never
  // rewritten over a newer one someone else may have just saved.
  function patchFromDraft() {
    const patch = {};
    const same = (a, b) => (a ?? '') === (b ?? '');
    if (!same(draft.activityType, live.activityType)) patch.activityType = draft.activityType || null;
    if (!same(draft.tourDate, live.tourDate)) patch.tourDate = draft.tourDate || null;
    if (!same(draft.tourTime, live.tourTime)) patch.tourTime = draft.tourTime || null;
    if (!same(draft.tourLanguage, live.tourLanguage)) patch.tourLanguage = draft.tourLanguage || null;
    if (!same(draft.locationId, live.locationId)) patch.locationId = draft.locationId || null;
    if (!same(draft.productVariantId, live.productVariantId)) {
      patch.productVariantId = draft.productVariantId || null;
    }
    const p = draft.participants === '' || draft.participants == null ? null : Number(draft.participants);
    if (p !== (live.participants ?? null)) patch.participants = p;
    return patch;
  }

  // ONE action. The server merges the patch into the same request that flips
  // the status, re-runs the gate against the merged state, and applies both in
  // one transaction — so this can neither half-save nor half-win.
  async function completeAndWin() {
    // A REF, not the busy state: two clicks in the same tick both read the
    // pre-render `disabled`, so the state flag cannot stop the second one. This
    // is the click-level half of exactly-once — the server's WON transition
    // guard is the other half, and neither is a substitute for the other.
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.deals.update(deal.id, {
        ...patchFromDraft(),
        status: 'won',
        ...(tourEventId ? { tourEventId, allowOverbook } : {}),
      });
      onWon?.();
      onClose?.();
    } catch (e) {
      const code = e.payload?.error;
      if (code === 'won_requirements_missing') {
        // Something changed under us, or a field this form cannot fill is still
        // empty. Show the FRESH server verdict and stay open.
        setReadiness((r) => ({
          ...(r || {}),
          missing: e.payload.missing || [],
          activityType: e.payload.activityType || r?.activityType,
          needsSlot: false,
          ready: false,
        }));
        setError('עדיין חסרים פרטים — הרשימה למטה עודכנה.');
      } else if (code === 'tour_slot_required') {
        // The group slot is a real choice with real capacity — never guessed.
        onNeedSlot?.(patchFromDraft());
      } else if (code === 'tour_full') {
        const { capacity, activeSeats, requested } = e.payload;
        setError(`הסיור מלא: קיבולת ${capacity}, תפוסה ${activeSeats}, מבוקש ${requested}. בחרו סיור אחר או שבצו במפורש מעל הקיבולת.`);
      } else {
        setError(ERROR_HE[code] || `הפעולה נכשלה: ${code || e.message}`);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!deal) return null;
  const canSubmit = !busy && !checking && readiness?.ready;

  return (
    <>
      <Dialog
        open={open && !builderOpen}
        onClose={busy ? null : onClose}
        size="lg"
        title="השלמת פרטים וסגירת הדיל"
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={completeAndWin}
              disabled={!canSubmit}
              title={readiness?.ready ? undefined : 'עדיין חסרים פרטים'}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {busy ? 'שומר וסוגר…' : 'השלם והפוך ל-WON'}
            </button>
          </>
        }
      >
        <div dir="rtl" className="space-y-5 py-1">
          <p className="text-sm leading-relaxed text-gray-700">
            סגירת דיל כ-WON יוצרת סיור אמיתי — אין סיורי טיוטה. השלימו כאן את מה שחסר;
            השמירה והסגירה קורות יחד, בלחיצה אחת.
          </p>

          {/* Activity type. Shown whenever the SYSTEM resolved it rather than a
              person choosing — the resolution is real and the sale is never
              blocked over it, but it is presented as an assumption to confirm,
              not as a decision somebody made. */}
          {shows('activityType') && (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="mb-2 text-[12px] font-medium text-gray-600">
                סוג פעילות
                {readiness?.activityTypeAssumed && (
                  <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800">
                    הונח על ידי המערכת{readiness.activityTypeReason ? ` · ${ASSUMED_REASON_HE[readiness.activityTypeReason] || ''}` : ''}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {ACTIVITY_TYPES.map((key) => {
                  const active = (draft.activityType || readiness?.activityType) === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={busy}
                      onClick={() => set({ activityType: key })}
                      className={
                        'rounded-lg border px-4 py-2 text-sm font-medium transition '
                        + (active
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50')
                      }
                    >
                      {ACTIVITY_TYPE_LABELS[key]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Everything the type actually requires. The set changes live with
              the choice above — this is the gate's own answer, re-asked. */}
          {(shows('tourDate') || shows('tourTime') || shows('participants')
            || shows('tourLanguage') || shows('locationId')) && (
            <div className="grid grid-cols-2 gap-3">
              {shows('tourDate') && (
                <DateField
                  label="תאריך הסיור"
                  value={draft.tourDate}
                  clearable={false}
                  onChange={(v) => set({ tourDate: v || '' })}
                />
              )}
              {shows('tourTime') && (
                <TimeField
                  label="שעת הסיור"
                  value={draft.tourTime}
                  clearable={false}
                  onChange={(v) => set({ tourTime: v || '' })}
                />
              )}
              {shows('participants') && (
                <FieldBox label="כמות משתתפים">
                  <input
                    type="number"
                    min="1"
                    dir="ltr"
                    className={FIELD_BOX}
                    value={draft.participants}
                    onChange={(e) => set({ participants: e.target.value })}
                  />
                </FieldBox>
              )}
              {shows('tourLanguage') && (
                <FieldBox label="שפת הסיור">
                  <select
                    className={`${FIELD_BOX} bg-white`}
                    value={draft.tourLanguage}
                    onChange={(e) => set({ tourLanguage: e.target.value })}
                  >
                    <option value="">בחרו שפה…</option>
                    {LANG_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </FieldBox>
              )}
              {shows('locationId') && (
                <FieldBox
                  label="עיר / מיקום"
                  hint={draft.productId ? 'בחירת עיר קובעת גם את הווריאציה של המוצר' : undefined}
                >
                  <select
                    className={`${FIELD_BOX} bg-white`}
                    value={draft.locationId}
                    onChange={(e) => chooseCity(e.target.value)}
                  >
                    <option value="">בחרו עיר…</option>
                    {cityOptions.recommended.length > 0 && (
                      <optgroup label="מומלץ למוצר זה">
                        {cityOptions.recommended.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={cityOptions.recommended.length ? 'מיקומים נוספים' : 'מיקומים'}>
                      {cityOptions.others.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </optgroup>
                  </select>
                </FieldBox>
              )}
            </div>
          )}

          {/* Product — the Builder owns it. Opening the real one is the whole
              action; a picker here would be a second, weaker writer for a field
              that already has an owner. */}
          {productBlocked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-[13px] font-medium text-amber-900">עדיין לא נבחר מוצר</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-amber-900">
                המוצר והמחיר נקבעים יחד בבונה המחיר. פתחו אותו, בחרו מוצר ושמרו — ותחזרו לכאן להשלמה.
              </p>
              <button
                type="button"
                onClick={() => setBuilderOpen(true)}
                className="mt-2 rounded-lg bg-blue-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-700"
              >
                פתיחת בונה המחיר
              </button>
            </div>
          )}
          {variantBlocked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-[12.5px] text-amber-900">
              לעיר שנבחרה אין וריאציה מוגדרת של המוצר. בחרו עיר אחרת, או הגדירו את הווריאציה בבונה המחיר.
            </div>
          )}

          {/* Anything the gate reports that this form does not cover. Named
              explicitly — an unlisted blocker would read as "all clear". */}
          {blockers.filter((m) => m.field !== 'productId' && m.field !== 'productVariantId').length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-[13px] text-amber-900">
              חסר גם:{' '}
              <span className="font-semibold">
                {blockers.filter((m) => m.field !== 'productId' && m.field !== 'productVariantId')
                  .map((m) => m.labelHe).join(', ')}
              </span>{' '}
              — את אלה משלימים בכרטיס "פרטי הסיור" בדיל.
            </div>
          )}

          {readiness?.needsSlot && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-[13px] text-blue-900">
              זהו דיל קבוצתי — אחרי ההשלמה תיבחר השיבוץ לסיור הקבוצתי, עם התפוסה הזמינה.
              המערכת לא תנחש סיור.
            </div>
          )}

          {readiness?.ready && !error && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-[13px] font-medium text-emerald-900">
              ✓ הכל מוכן — לחיצה על "השלם והפוך ל-WON" תשמור את הפרטים ותסגור את הדיל.
            </p>
          )}
          {checking && <p className="text-[12px] text-gray-400">בודק מה עוד נדרש…</p>}
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</p>
          )}
        </div>
      </Dialog>

      {/* The canonical Builder, opened from inside the flow. Its save writes the
          product exactly as it always does; on close the checklist re-asks. */}
      {builderOpen && (
        <PriceBuilderDialog
          open
          deal={live}
          context={priceContext}
          onClose={() => setBuilderOpen(false)}
          onSaved={async () => {
            setBuilderOpen(false);
            try {
              const fresh = await api.deals.get(deal.id);
              setLive(fresh);
              // Adopt ONLY what the Builder owns — the operator's own entries
              // in this form are never overwritten by the refetch.
              setDraft((d) => ({
                ...d,
                productId: fresh.productId || '',
                productVariantId: fresh.productVariantId || d.productVariantId || '',
                locationId: d.locationId || fresh.locationId || '',
              }));
            } catch { /* the readiness probe below still reports the truth */ }
          }}
        />
      )}
    </>
  );
}
