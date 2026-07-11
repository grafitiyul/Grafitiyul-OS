import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import AnchoredMenu from '../common/AnchoredMenu.jsx';
import TourTeamEditor from './TourTeamEditor.jsx';
import TourComponents from './TourComponents.jsx';
import ComponentChipList from './ComponentChips.jsx';

// "תכנון סיור" — the PRE-WON planning surface inside the Deal's tour card
// (private/business deals only, while no real tour exists). Everything here is
// STRICTLY internal: planned guides/components live on DealTourPlan — no
// TourEvent, no Google Calendar event, no guide invitation, no portal
// visibility. At WON the plan materializes into the real tour and this banner
// is replaced by the live DealTourSummary on the SAME card surface (one card,
// switching state — never a second card).
//
// Team + components reuse the SHARED editors (TourTeamEditor/TourComponents)
// through the api.dealTourPlan endpoint adapter — one UI, two backends.
//
// Components semantics: until customized, the plan FOLLOWS the variant's live
// defaults (shown read-only; a later variant change updates them naturally).
// "התאמה אישית" copies the defaults into the plan and the plan's own list
// becomes authoritative — including an intentionally-empty list.
export default function DealTourPlanning({ deal }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const anchorRef = useRef(null);
  const popWidth = Math.min(480, (typeof window !== 'undefined' ? window.innerWidth : 480) - 32);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.dealTourPlan.get(deal.id);
      setData(r);
      setNotes(r.plan?.notes || '');
    } catch {
      /* transient — the banner stays usable */
    } finally {
      setLoading(false);
    }
  }, [deal.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const plan = data?.plan;
  const customized = !!plan?.componentsCustomized;

  async function saveNotes() {
    if ((notes || '') === (plan?.notes || '')) return;
    try {
      const updated = await api.dealTourPlan.update(deal.id, { notes: notes || null });
      setData((d) => ({ ...d, plan: updated }));
    } catch {
      /* buffer stays — the next blur retries */
    }
  }

  async function customizeComponents() {
    try {
      await api.dealTourPlan.reseedComponents(deal.id);
      await load();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  async function resetComponents() {
    if (!window.confirm('לחזור לברירת המחדל של הווריאציה? ההתאמות שבוצעו לרשימת המרכיבים יימחקו.')) return;
    try {
      await api.dealTourPlan.resetComponents(deal.id);
      await load();
    } catch (e) {
      alert('שגיאה: ' + (e.payload?.error || e.message));
    }
  }

  return (
    <div>
      {/* Planning banner — dashed + muted = "this is a plan, not a tour". */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50/70 px-3 py-2">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-w-0 text-right text-[13px] text-gray-700 hover:text-gray-900"
          title="תכנון סיור — פנימי בלבד"
        >
          <span className="me-1">🗺️</span>
          <span className="font-semibold">תכנון סיור</span>
          <span className="ms-1 text-gray-400">{open ? '▴' : '▾'}</span>
        </button>
        <span className="shrink-0 rounded-full bg-gray-200/80 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
          טרם נוצר סיור
        </span>
      </div>

      {/* Portal popover — same pattern as DealTourSummary (never clipped). */}
      <AnchoredMenu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={popWidth} align="start">
        <div className="p-3" dir="rtl">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[14px] font-bold text-gray-900">תכנון סיור</span>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
              פנימי
            </span>
          </div>
          <p className="mb-3 text-[12px] leading-relaxed text-gray-500">
            תכנון פנימי בלבד — הסיור ייווצר בפועל כשהדיל ייסגר (WON). מדריכים מתוכננים לא
            מקבלים שום עדכון, זימון או גישה בשלב זה.
          </p>

          {loading && !data ? (
            <div className="py-6 text-center text-[13px] text-gray-400">טוען…</div>
          ) : !data ? (
            <div className="py-6 text-center text-[13px] text-gray-400">לא ניתן לטעון את התכנון.</div>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {/* Planned team */}
              <section>
                <h4 className="mb-1.5 text-[12px] font-bold text-gray-500">צוות מתוכנן</h4>
                <TourTeamEditor
                  tourId={deal.id}
                  assignments={plan?.assignments || []}
                  onChanged={load}
                  endpoints={api.dealTourPlan}
                />
              </section>

              {/* Planned components */}
              <section>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h4 className="text-[12px] font-bold text-gray-500">מרכיבי הפעילות</h4>
                  {customized ? (
                    <button
                      type="button"
                      onClick={resetComponents}
                      className="text-[11.5px] font-semibold text-gray-400 hover:text-gray-600"
                    >
                      חזרה לברירת המחדל
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={customizeComponents}
                      className="rounded-lg border border-gray-300 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      ✎ התאמה אישית
                    </button>
                  )}
                </div>
                {customized ? (
                  <TourComponents
                    tourId={deal.id}
                    rows={plan?.activityComponents || []}
                    onChanged={load}
                    endpoints={api.dealTourPlan}
                  />
                ) : (
                  <>
                    <ComponentChipList
                      rows={data.variantDefaults || []}
                      empty={
                        deal.productVariantId
                          ? 'לווריאציה שנבחרה אין מרכיבי ברירת מחדל.'
                          : 'בחרו מוצר ועיר כדי לראות מרכיבי ברירת מחדל.'
                      }
                    />
                    {(data.variantDefaults || []).length > 0 && (
                      <p className="mt-1 text-[11.5px] text-gray-400">
                        לפי ברירת המחדל של הווריאציה — מתעדכן אוטומטית אם המוצר/וריאציה ישתנו.
                      </p>
                    )}
                  </>
                )}
              </section>

              {/* Planning notes → TourEvent.notes at WON */}
              <section>
                <h4 className="mb-1.5 text-[12px] font-bold text-gray-500">הערות תפעוליות</h4>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={saveNotes}
                  rows={3}
                  placeholder="הערות פנימיות לסיור המתוכנן… (יועברו לסיור כשייווצר)"
                  className="w-full rounded-lg border border-gray-200 p-2 text-[13px] text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </section>
            </div>
          )}
        </div>
      </AnchoredMenu>
    </div>
  );
}
