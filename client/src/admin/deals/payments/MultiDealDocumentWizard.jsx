import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '../../common/Dialog.jsx';
import { api } from '../../../lib/api.js';
import { reconcileAllocations } from '../../../../../shared/paymentAllocation.mjs';

// "מסמך אחד לדילים שונים" — configuring ONE accounting document that covers
// several deals.
//
// This is an ACCOUNTING workflow, not an allocation screen. At every stage the
// operator can see: which deal, which source document, how much of that
// document, how much the new document is, what closes fully and what stays
// partial. The words "allocation group" never appear.
//
// NOTHING IS ISSUED HERE. The wizard produces a plan and hands it back to the
// normal "הפק מסמך" composer, which the operator reviews and issues from
// exactly as always. There is one document composer in GOS and one issue path.
//
// Staged sections, not screen replacement — the same pattern as DealMergeWizard
// and the Open Tour registration modal: the active section expands, completed
// ones collapse to a summary and reopen on click, and every earlier answer
// stays changeable until the final confirm.

const STEPS = [
  { key: 'doctype', title: 'איזה מסמך להפיק?' },
  { key: 'deals', title: 'דילים ומסמכי מקור' },
  { key: 'amount', title: 'סכום המסמך החדש' },
  { key: 'review', title: 'סקירה ואישור' },
];

const fmt = (n) =>
  `₪${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const toIls = (text) => {
  const n = Number(String(text ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const ERROR_HE = {
  invalid_doctype: 'סוג המסמך אינו נתמך.',
  deals_required: 'יש לבחור לפחות דיל אחד.',
  deal_duplicate: 'אותו דיל נבחר פעמיים.',
  deal_not_found: 'אחד הדילים לא נמצא.',
  base_document_type_invalid: 'מסמך המקור שנבחר אינו מתאים לסוג המסמך החדש.',
  allocation_amount_invalid: 'אחד הסכומים אינו תקין.',
  icount_request_failed: 'אייקאונט לא הגיב כמצופה. נסו שוב.',
};

export default function MultiDealDocumentWizard({ open, dealId, docTypes, onClose, onConfirm }) {
  const [step, setStep] = useState('doctype');
  const [doctype, setDoctype] = useState(null);
  // The ordered stack. Order here IS the document's line order.
  const [items, setItems] = useState([]); // [{ dealId, orderNo, contactName, …, basedOn, allocationText }]
  const [amountText, setAmountText] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [plan, setPlan] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(null);
  const [crossConfirmed, setCrossConfirmed] = useState(false);
  const seedRef = useRef(null);

  // Seed on the DEAL IDENTITY, never on a refetched object — a background
  // refresh must not reset a half-built document.
  useEffect(() => {
    if (!open) { seedRef.current = null; return; }
    if (seedRef.current === dealId) return;
    seedRef.current = dealId;
    setStep('doctype');
    setDoctype(null);
    setItems([]);
    setAmountText('');
    setAmountTouched(false);
    setPlan(null);
    setError(null);
    setCrossConfirmed(false);
  }, [open, dealId]);

  // The originating deal is Deal #1 as soon as a document type is chosen.
  useEffect(() => {
    if (!open || !doctype || items.length) return;
    let alive = true;
    (async () => {
      try {
        const d = await api.deals.get(dealId);
        if (!alive) return;
        setItems([{
          dealId,
          orderNo: d.orderNo,
          title: d.title,
          contactName: d.contacts?.find((c) => c.isPrimary)?.contact
            ? contactLabel(d.contacts.find((c) => c.isPrimary).contact)
            : null,
          organizationName: d.organization?.name || null,
          productName: d.product?.nameHe || null,
          tourDate: d.tourDate || null,
          totalMinor: Number(d.valueMinor || 0),
          basedOn: null,
          allocationText: '',
        }]);
      } catch {
        if (alive) setError('לא ניתן לטעון את הדיל הנוכחי.');
      }
    })();
    return () => { alive = false; };
  }, [open, doctype, dealId, items.length]);

  const allSourcesChosen = items.length > 0 && items.every((i) => i.basedOn !== undefined);
  const sumSourcesIls = useMemo(
    () => items.reduce((s, i) => s + (i.basedOn?.amountIls ?? i.totalMinor / 100), 0),
    [items],
  );

  // The proposed amount, until the operator states their own.
  useEffect(() => {
    if (!amountTouched && items.length) setAmountText(String(round2(sumSourcesIls)));
  }, [sumSourcesIls, amountTouched, items.length]);

  const amountIls = toIls(amountText);
  // The live reconciliation — the SAME function the server persists with.
  const localState = useMemo(() => reconcileAllocations(
    Math.round(amountIls * 100),
    items.map((i) => ({
      dealId: i.dealId,
      amountMinor: Math.round(effectiveAllocation(i) * 100),
    })),
  ), [amountIls, items]);

  const prepare = useCallback(async ({ withAmount = true } = {}) => {
    setPreparing(true);
    setError(null);
    try {
      const res = await api.payments.prepareMultiDealDocument({
        doctype,
        amountIls: withAmount ? amountIls : undefined,
        items: items.map((i) => ({
          dealId: i.dealId,
          basedOn: i.basedOn ? { doctype: i.basedOn.doctype, docnum: i.basedOn.docnum } : null,
          allocationIls: effectiveAllocation(i),
        })),
      });
      setPlan(res);
      return res;
    } catch (e) {
      setError(ERROR_HE[e?.body?.error] || e?.body?.reason || 'לא ניתן להרכיב את המסמך.');
      return null;
    } finally {
      setPreparing(false);
    }
  }, [doctype, amountIls, items]);

  function setItem(id, patch) {
    setItems((prev) => prev.map((i) => (i.dealId === id ? { ...i, ...patch } : i)));
  }

  const crossCustomer = plan?.crossCustomer?.cross;
  const canConfirm = !!plan && !preparing && (!crossCustomer || crossConfirmed);

  return (
    <Dialog
      open={open}
      onClose={preparing ? undefined : onClose}
      title="מסמך אחד לדילים שונים"
      size="xl"
      ariaLabel="הפקת מסמך חשבונאי אחד שמכסה כמה דילים"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-400">
            שום מסמך לא מופק כאן. בסיום תחזרו לחלון הפקת המסמך הרגיל לבדיקה אחרונה.
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={preparing}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              ביטול
            </button>
            {step !== 'review' ? (
              <button
                type="button"
                onClick={async () => {
                  if (step === 'amount') { if (!(await prepare())) return; }
                  setStep(nextStep(step));
                }}
                disabled={!canAdvance(step, { doctype, items, allSourcesChosen, amountIls }) || preparing}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
                {preparing ? 'מרכיב…' : 'המשך'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onConfirm(plan)}
                disabled={!canConfirm}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                אישור וחזרה להפקת המסמך
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-3" dir="rtl">
        <Section
          index={1} title={STEPS[0].title}
          active={step === 'doctype'} done={!!doctype}
          summary={doctype ? docTypes.find((t) => t.key === doctype)?.label : null}
          onOpen={() => setStep('doctype')}
        >
          <p className="mb-2 text-[13px] text-gray-600">
            סוג המסמך קובע אילו מסמכים קיימים יכולים לשמש כמסמכי מקור.
          </p>
          <div className="flex flex-wrap gap-2">
            {(docTypes || []).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => { setDoctype(t.key); setItems((p) => p.map((i) => ({ ...i, basedOn: null }))); setPlan(null); }}
                className={`rounded-lg border px-3 py-2 text-[13px] font-medium ${
                  doctype === t.key ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Section>

        <Section
          index={2} title={STEPS[1].title}
          active={step === 'deals'} done={allSourcesChosen && items.length > 0}
          disabled={!doctype}
          summary={items.length ? `${items.length} דילים · ${fmt(sumSourcesIls)}` : null}
          onOpen={() => doctype && setStep('deals')}
        >
          <DealStack
            items={items}
            doctype={doctype}
            docTypes={docTypes}
            onSetSource={(id, basedOn) => { setItem(id, { basedOn }); setPlan(null); }}
            onRemove={(id) => { setItems((p) => p.filter((i) => i.dealId !== id)); setPlan(null); }}
            onAdd={(deal) => {
              setItems((p) => p.some((i) => i.dealId === deal.id) ? p : [...p, {
                dealId: deal.id,
                orderNo: deal.orderNo,
                title: deal.title,
                contactName: deal.contactName,
                organizationName: deal.organizationName,
                productName: deal.product || null,
                tourDate: deal.tourDate || null,
                totalMinor: deal.totalMinor ?? deal.valueMinor ?? 0,
                paidMinor: deal.paidMinor ?? null,
                remainingMinor: deal.remainingMinor ?? null,
                basedOn: null,
                allocationText: '',
              }]);
              setPlan(null);
            }}
            originDealId={dealId}
          />
        </Section>

        <Section
          index={3} title={STEPS[2].title}
          active={step === 'amount'} done={amountIls > 0 && localState.state !== 'empty'}
          disabled={!items.length}
          summary={amountIls > 0 ? fmt(amountIls) : null}
          onOpen={() => items.length && setStep('amount')}
        >
          <AmountStep
            items={items}
            amountText={amountText}
            onAmount={(v) => { setAmountText(v); setAmountTouched(true); setPlan(null); }}
            onAllocation={(id, v) => { setItem(id, { allocationText: v }); setPlan(null); }}
            state={localState}
            sumSourcesIls={sumSourcesIls}
          />
        </Section>

        <Section
          index={4} title={STEPS[3].title}
          active={step === 'review'} done={false}
          disabled={!plan}
          onOpen={() => plan && setStep('review')}
        >
          {plan && (
            <ReviewStep
              plan={plan}
              crossConfirmed={crossConfirmed}
              onCrossConfirm={setCrossConfirmed}
            />
          )}
        </Section>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}
      </div>
    </Dialog>
  );
}

// ── The Deal + source-document stack ─────────────────────────────────────────

function DealStack({ items, doctype, docTypes, onSetSource, onRemove, onAdd, originDealId }) {
  return (
    <div className="space-y-3">
      {items.map((item, idx) => (
        <DealRow
          key={item.dealId}
          item={item}
          index={idx + 1}
          doctype={doctype}
          docTypes={docTypes}
          isOrigin={item.dealId === originDealId}
          onSetSource={(b) => onSetSource(item.dealId, b)}
          onRemove={() => onRemove(item.dealId)}
        />
      ))}
      <AddDealSearch excludeIds={items.map((i) => i.dealId)} onPick={onAdd} />
    </div>
  );
}

function DealRow({ item, index, doctype, docTypes, isOrigin, onSetSource, onRemove }) {
  const [candidates, setCandidates] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);

  useEffect(() => {
    if (!doctype) return undefined;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res = await api.payments.multiDealSources(item.dealId, doctype);
        if (alive) { setCandidates(res.candidates || []); setLiveError(res.liveError || null); }
      } catch {
        if (alive) { setCandidates([]); setLiveError('load_failed'); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [item.dealId, doctype]);

  const typeDef = (docTypes || []).find((t) => t.key === doctype);
  const baseLabels = (typeDef?.baseTypes || []).map((k) => docTypes.find((t) => t.key === k)?.label).filter(Boolean);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* The rich Deal card — everything needed to know WHICH deal this is. */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">{index}</span>
            <span className="text-[14px] font-semibold text-gray-900">דיל #{item.orderNo}</span>
            {isOrigin && <span className="rounded bg-blue-50 px-1.5 py-px text-[10.5px] text-blue-700">הדיל הנוכחי</span>}
          </div>
          <div className="mt-0.5 text-[13px] text-gray-700">{item.contactName || item.title || '—'}</div>
          <div className="text-[12px] text-gray-500">
            {[item.organizationName, item.productName, item.tourDate].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div className="shrink-0 text-left text-[12px] text-gray-600">
          <div>סכום הדיל {fmt(item.totalMinor / 100)}</div>
          {item.paidMinor != null && <div className="text-gray-400">שולם {fmt(item.paidMinor / 100)}</div>}
          {item.remainingMinor != null && <div className="text-gray-400">נותר {fmt(item.remainingMinor / 100)}</div>}
          {!isOrigin && (
            <button type="button" onClick={onRemove} className="mt-1 text-[11.5px] text-gray-400 hover:text-red-600">
              הסר דיל
            </button>
          )}
        </div>
      </div>

      <div className="px-3 py-2.5">
        <p className="mb-1.5 text-[12.5px] font-semibold text-gray-600">
          איזה מסמך מהדיל הזה המסמך החדש מבוסס עליו?
        </p>
        {loading && <p className="text-[12.5px] text-gray-400">טוען מסמכים…</p>}

        {!loading && candidates && candidates.length === 0 && (
          <p className="text-[12.5px] text-gray-500">
            לא נמצאו מסמכים מתאימים ({baseLabels.join(' / ') || '—'}) בדיל הזה.
          </p>
        )}

        {!loading && candidates && candidates.length > 0 && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-[13px] text-gray-700">
              <input type="radio" name={`src-${item.dealId}`} checked={!item.basedOn} onChange={() => onSetSource(null)} />
              ללא מסמך מקור — שורות הדיל עצמו
            </label>
            {candidates.map((c) => (
              <label key={`${c.doctype}:${c.docnum}`} className="flex items-start gap-2 rounded-lg px-1 py-1 text-[13px] text-gray-700 hover:bg-gray-50">
                <input
                  type="radio" name={`src-${item.dealId}`} className="mt-1"
                  checked={item.basedOn?.doctype === c.doctype && item.basedOn?.docnum === c.docnum}
                  onChange={() => onSetSource(c)}
                />
                <span className="min-w-0">
                  <span className="font-medium">{c.doctypeLabel} מס׳ {c.docnum}</span>
                  <span className="text-gray-500">
                    {c.amountIls != null && ` · ${fmt(c.amountIls)}`}
                    {c.issuedAt && ` · ${String(c.issuedAt).slice(0, 10)}`}
                  </span>
                  <span className="block text-[11.5px] text-gray-400">
                    {[c.clientName,
                      // GOS does not know whether a document it issued was
                      // later closed at iCount — say "unknown", never guess.
                      c.status ? STATUS_HE[c.status] : 'מצב סגירה לא ידוע',
                      c.origin === 'gos' ? 'הופק מ־GOS' : c.origin === 'linked' ? 'שויך ידנית' : 'iCount',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOtherOpen((v) => !v)}
          className="mt-2 text-[12.5px] font-medium text-blue-700 hover:underline"
        >
          {otherOpen ? 'סגירה' : 'בחירת מסמך אחר'}
        </button>
        {otherOpen && (
          <OtherDocumentSearch
            dealId={item.dealId}
            doctype={doctype}
            docTypes={docTypes}
            onPick={(d) => { onSetSource(d); setOtherOpen(false); }}
          />
        )}
        {liveError && (
          <p className="mt-1 text-[11.5px] text-amber-700">
            חיפוש מסמכים חיים ב־iCount לא זמין כרגע — מוצגים מסמכים שהופקו/שויכו ב־GOS בלבד.
          </p>
        )}
      </div>
    </div>
  );
}

const STATUS_HE = { open: 'פתוח', partial: 'נסגר חלקית', closed: 'סגור' };

// "בחירת מסמך אחר" — the CANONICAL iCount document search already used by the
// single-deal link flow. Not a second implementation.
function OtherDocumentSearch({ dealId, doctype, docTypes, onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const typeDef = (docTypes || []).find((t) => t.key === doctype);
  const allowed = new Set(typeDef?.baseTypes || []);

  async function run() {
    if (!q.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await api.deals.icountSearchDocuments(dealId, q.trim(), null);
      setRows((res.documents || []).filter((d) => allowed.has(d.doctype)));
    } catch (e) {
      setErr(e?.body?.error === 'phone_search_unsupported'
        ? 'אייקאונט לא תומך בחיפוש לפי טלפון. חפשו לפי מספר מסמך, שם, אימייל או ח.פ.'
        : 'החיפוש נכשל.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-2">
      <div className="flex gap-2">
        <input
          className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-[13px]"
          value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="מספר מסמך / שם לקוח / אימייל / ח.פ"
        />
        <button type="button" onClick={run} disabled={busy}
          className="shrink-0 rounded-lg bg-gray-900 px-3 text-[12.5px] font-medium text-white disabled:opacity-50">
          {busy ? '…' : 'חיפוש'}
        </button>
      </div>
      {err && <p className="mt-1 text-[12px] text-amber-700">{err}</p>}
      {rows.length > 0 && (
        <ul className="mt-2 max-h-52 divide-y divide-gray-200 overflow-y-auto rounded-lg bg-white">
          {rows.map((d) => (
            <li key={`${d.doctype}:${d.docnum}`}>
              <button type="button" onClick={() => onPick(d)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-right text-[13px] hover:bg-gray-50">
                <span>
                  {d.doctypeLabel} מס׳ {d.docnum}
                  <span className="block text-[11.5px] text-gray-500">
                    {[d.clientName, d.issuedAt && String(d.issuedAt).slice(0, 10), STATUS_HE[d.status]].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {d.amountIls != null && <span className="shrink-0 text-gray-600">{fmt(d.amountIls)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The canonical Deal search (global-search provider + real collection figures).
function AddDealSearch({ excludeIds, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(async () => {
      const n = ++seq.current;
      if (q.trim().length < 2) { setResults([]); return; }
      setLoading(true);
      try {
        const res = await api.payments.searchDeals(q.trim(), excludeIds);
        if (n === seq.current) setResults(res.results || []);
      } catch { if (n === seq.current) setResults([]); } finally { if (n === seq.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, excludeIds]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-gray-300 py-2.5 text-[13px] font-medium text-blue-700 hover:bg-blue-50/50">
        + הוסף דיל
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-2">
      <input autoFocus className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-[13px]"
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="חיפוש לפי מספר דיל, שם, טלפון, אימייל, ארגון…" />
      {loading && <p className="mt-1 text-[12px] text-gray-400">מחפש…</p>}
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <p className="mt-1 text-[12px] text-gray-400">לא נמצאו דילים.</p>
      )}
      {results.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-gray-200 overflow-y-auto rounded-lg bg-white">
          {results.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => { onPick(d); setOpen(false); setQ(''); setResults([]); }}
                className="flex w-full items-start justify-between gap-3 px-2.5 py-2 text-right hover:bg-gray-50">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-gray-900">#{d.orderNo} · {d.contactName || d.title}</span>
                  <span className="block truncate text-[11.5px] text-gray-500">
                    {[d.organizationName, d.product, d.tourDate].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
                <span className="shrink-0 text-left text-[11.5px] text-gray-600">
                  <span className="block">סה״כ {fmt(d.totalMinor / 100)}</span>
                  <span className="block text-gray-400">שולם {fmt(d.paidMinor / 100)}</span>
                  <span className="block text-gray-400">נותר {fmt(d.remainingMinor / 100)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setOpen(false)} className="mt-1 text-[12px] text-gray-500 hover:underline">ביטול</button>
    </div>
  );
}

// ── Amount + what each source document closes ────────────────────────────────

function AmountStep({ items, amountText, onAmount, onAllocation, state, sumSourcesIls }) {
  const matches = Math.abs(toIls(amountText) - sumSourcesIls) < 0.01;
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] text-gray-600">מה סכום המסמך החדש?</span>
          <div className="flex items-center gap-1">
            <span className="text-gray-400">₪</span>
            <input className="w-40 rounded-lg border border-gray-300 px-2 py-1.5 text-sm" inputMode="decimal"
              value={amountText} onChange={(e) => onAmount(e.target.value)} />
          </div>
        </label>
        <div className="pb-1.5 text-[12.5px] text-gray-500">
          סכום מסמכי המקור: {fmt(sumSourcesIls)}
        </div>
      </div>

      {/* When the amount matches what the sources are worth, do NOT ask
          unnecessary questions — just show what will close. */}
      {matches && state.state === 'balanced' ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
          <p className="mb-1.5 text-[12.5px] font-semibold text-emerald-900">הסכום מכסה במדויק את מסמכי המקור:</p>
          <ul className="space-y-0.5 text-[13px] text-emerald-900">
            {items.map((i) => (
              <li key={i.dealId} className="flex justify-between">
                <span>{fmt(effectiveAllocation(i))} ← דיל #{i.orderNo}{i.basedOn ? ` · ${i.basedOn.doctypeLabel} ${i.basedOn.docnum}` : ''}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 border-t border-emerald-200 pt-1.5 text-[13px] font-semibold text-emerald-900">
            סה״כ {fmt(state.allocatedMinor / 100)}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((i) => {
            const source = i.basedOn;
            const alloc = effectiveAllocation(i);
            const remaining = source?.amountIls != null ? source.amountIls - alloc : null;
            return (
              <div key={i.dealId} className="rounded-xl border border-gray-200 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-[13px]">
                    <div className="font-medium text-gray-900">
                      דיל #{i.orderNo}{source ? ` · ${source.doctypeLabel} ${source.docnum}` : ' · ללא מסמך מקור'}
                    </div>
                    <div className="text-[12px] text-gray-500">
                      {source?.amountIls != null ? `סה״כ המסמך: ${fmt(source.amountIls)}` : `סכום הדיל: ${fmt(i.totalMinor / 100)}`}
                    </div>
                  </div>
                  <label className="shrink-0">
                    <span className="mb-0.5 block text-[11.5px] text-gray-500">לסגור במסמך החדש</span>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400">₪</span>
                      <input className="w-28 rounded-lg border border-gray-300 px-2 py-1 text-sm" inputMode="decimal"
                        value={i.allocationText !== '' ? i.allocationText : String(round2(alloc))}
                        onChange={(e) => onAllocation(i.dealId, e.target.value)} />
                    </div>
                  </label>
                </div>
                {remaining != null && remaining > 0.01 && (
                  <p className="mt-1 text-[12px] text-amber-700">
                    ייסגר חלקית — יישארו {fmt(remaining)} פתוחים ב{source.doctypeLabel} {source.docnum}
                  </p>
                )}
                {remaining != null && Math.abs(remaining) <= 0.01 && (
                  <p className="mt-1 text-[12px] text-emerald-700">ייסגר במלואו</p>
                )}
              </div>
            );
          })}

          <Totals state={state} items={items} onAllocation={onAllocation} />
        </div>
      )}
    </div>
  );
}

function Totals({ state, items, onAllocation }) {
  const over = state.state === 'over';
  const under = state.state === 'unallocated';
  return (
    <div className="rounded-xl border border-gray-200">
      <div className="grid grid-cols-3 divide-x divide-x-reverse divide-gray-100 text-center">
        <Figure label="סכום המסמך החדש" value={fmt(state.realMinor / 100)} />
        <Figure label="שויך" value={fmt(state.allocatedMinor / 100)} />
        <Figure
          label={over ? 'שויך ביתר' : 'לא שויך'}
          value={fmt((over ? state.overAllocatedMinor : state.unallocatedMinor) / 100)}
          tone={over ? 'danger' : under ? 'warn' : 'ok'}
        />
      </div>
      {under && (
        <div className="border-t border-amber-100 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
          <div className="font-medium">נותרו {fmt(state.unallocatedMinor / 100)} שלא שויכו</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {items.map((i) => (
              <button key={i.dealId} type="button"
                onClick={() => onAllocation(i.dealId, String(round2(effectiveAllocation(i) + state.unallocatedMinor / 100)))}
                className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11.5px] hover:bg-amber-100">
                הוסף לדיל #{i.orderNo}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[11.5px] text-amber-800">
            אפשר גם להמשיך כך — הסכום יישאר לא משויך ותיפתח משימה לטיפול. יתרת זכות ללקוח לא נוצרת אוטומטית.
          </div>
        </div>
      )}
      {over && (
        <div className="border-t border-red-100 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-800">
          <div className="font-medium">שויכו {fmt(state.overAllocatedMinor / 100)} יותר מסכום המסמך.</div>
          <div className="mt-1 text-red-700">
            אפשר להמשיך — אבל הכסף שיתקבל בפועל נשאר {fmt(state.realMinor / 100)}. ההפרש יסומן כאי-התאמה
            ולא ייחשב כהכנסה.
          </div>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, tone = 'ok' }) {
  const color = tone === 'danger' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900';
  return (
    <div className="px-2 py-2.5">
      <div className="text-[11.5px] text-gray-500">{label}</div>
      <div className={`text-[15px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}

// ── Review ───────────────────────────────────────────────────────────────────

function ReviewStep({ plan, crossConfirmed, onCrossConfirm }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-[13px]">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="text-[11.5px] text-gray-500">סוג המסמך</div>
          <div className="font-semibold text-gray-900">{plan.doctypeLabel}</div>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <div className="text-[11.5px] text-gray-500">סכום המסמך</div>
          <div className="font-semibold text-gray-900">{fmt(plan.amountIls)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200">
        <div className="border-b border-gray-100 px-3 py-2 text-[12px] font-semibold text-gray-500">מבוסס על</div>
        <ul className="divide-y divide-gray-100">
          {plan.perDeal.map((d) => (
            <li key={d.dealId} className="px-3 py-2 text-[13px]">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">
                    דיל #{d.orderNo}{d.contactName ? ` · ${d.contactName}` : ''}
                  </span>
                  <span className="block text-[12px] text-gray-600">
                    {d.basedOn ? `${d.basedOnLabel} מס׳ ${d.basedOn.docnum}` : 'ללא מסמך מקור — שורות הדיל'}
                    {d.sourceAmountIls != null && ` · ${fmt(d.sourceAmountIls)}`}
                  </span>
                  {d.sourceError && (
                    <span className="block text-[11.5px] text-amber-700">
                      ⚠ לא ניתן לקרוא את מסמך המקור — הקישור יישמר, יש לוודא שורות וסכום
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-left">
                  <span className="block font-semibold text-gray-900">{fmt(d.allocationIls)}</span>
                  <span className={`block text-[11.5px] ${d.fullSettlement ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {d.fullSettlement ? 'ייסגר במלואו' : `יישארו ${fmt(d.remainingAfterIls ?? 0)}`}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-gray-200 px-3 py-2 text-[13px] font-semibold">
          <span>סה״כ משויך</span>
          <span>{fmt(plan.allocatedIls)}</span>
        </div>
      </div>

      {plan.reconciliation?.state === 'unallocated' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          {fmt(plan.reconciliation.unallocatedMinor / 100)} מסכום המסמך יישארו לא משויכים ותיפתח משימה לטיפול.
        </p>
      )}
      {plan.reconciliation?.state === 'over' && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
          שויכו {fmt(plan.reconciliation.overAllocatedMinor / 100)} יותר מסכום המסמך. אפשר להמשיך — ההפרש
          יסומן כאי-התאמה ולא ייחשב כהכנסה.
        </p>
      )}
      {Math.abs(plan.linesTotalIls - plan.amountIls) > 0.11 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          שורות המסמך מסתכמות ב-{fmt(plan.linesTotalIls)} בעוד שסכום המסמך שהוגדר הוא {fmt(plan.amountIls)}.
          אפשר לתקן את השורות בחלון הפקת המסמך.
        </p>
      )}

      {plan.crossCustomer?.cross && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">
          <div className="font-medium">הדילים שנבחרו שייכים ללקוחות שונים.</div>
          <div className="mt-1">
            המסמך יופק על שם לקוח אחד בלבד — הלקוח שייבחר בחלון הפקת המסמך. ודאו שזו הכוונה.
          </div>
          <label className="mt-1.5 flex items-center gap-2">
            <input type="checkbox" checked={crossConfirmed} onChange={(e) => onCrossConfirm(e.target.checked)} />
            אני מאשר/ת להפיק מסמך אחד לכמה לקוחות
          </label>
        </div>
      )}

      <details className="rounded-xl border border-gray-200">
        <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-semibold text-gray-600">
          שורות המסמך ({plan.rows.length}) והערות — לפי סדר הדילים
        </summary>
        <div className="border-t border-gray-100 px-3 py-2">
          <ul className="space-y-0.5 text-[12.5px] text-gray-700">
            {plan.rows.map((r, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{r.quantity} × {r.description}</span>
                <span className="shrink-0 text-gray-500">{fmt(r.unitPriceIls * r.quantity)}</span>
              </li>
            ))}
          </ul>
          {plan.notes && (
            <pre className="mt-2 whitespace-pre-wrap border-t border-gray-100 pt-2 text-[12px] text-gray-600">{plan.notes}</pre>
          )}
        </div>
      </details>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Section({ index, title, active, done, summary, onOpen, disabled, children }) {
  return (
    <section className={`rounded-xl border ${active ? 'border-blue-300 shadow-sm' : 'border-gray-200'} ${disabled ? 'opacity-50' : ''}`}>
      <button type="button" onClick={disabled ? undefined : onOpen} disabled={disabled}
        className={`flex w-full items-center gap-3 px-4 py-3 text-right ${active ? 'bg-blue-50/60' : 'hover:bg-gray-50'} disabled:cursor-not-allowed`}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
          done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
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

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// What this deal closes: the operator's typed amount, else the source
// document's own total, else the deal's value.
function effectiveAllocation(item) {
  if (item.allocationText !== '' && item.allocationText != null) return toIls(item.allocationText);
  if (item.basedOn?.amountIls != null) return item.basedOn.amountIls;
  return round2((item.remainingMinor ?? item.totalMinor ?? 0) / 100);
}

function contactLabel(c) {
  return `${c.firstNameHe || c.firstNameEn || ''} ${c.lastNameHe || c.lastNameEn || ''}`.trim() || null;
}

function nextStep(step) {
  const i = STEPS.findIndex((s) => s.key === step);
  return STEPS[Math.min(i + 1, STEPS.length - 1)].key;
}

function canAdvance(step, { doctype, items, allSourcesChosen, amountIls }) {
  if (step === 'doctype') return !!doctype;
  if (step === 'deals') return items.length > 0 && allSourcesChosen;
  if (step === 'amount') return amountIls > 0;
  return true;
}
