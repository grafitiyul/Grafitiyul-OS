import { useEffect, useRef, useState } from 'react';
import Dialog from '../common/Dialog.jsx';
import { api } from '../../lib/api.js';
import { formatMinor } from '../../lib/money.js';
import { fmtTourDate } from '../tours/config.js';
import GroupTicketBuilder from './GroupTicketBuilder.jsx';
import WaiverDecisionDialog from './WaiverDecisionDialog.jsx';
import TourSlotModal from '../tours/TourSlotModal.jsx';
import CompletionModes from './CompletionModes.jsx';

// ONE persistent progressive modal for the whole group registration flow:
//   1) פרטי העסקה (reuses the Group Ticket Builder)
//   2) בחירת סיור (existing tour or create a new one)
//   3) השלמת ההרשמה (pay-now / send-link / no-payment)
// Only the active section expands; completed sections collapse to a summary and
// reopen on click. No wizard screen-replacement. Both entry points (the Group
// Builder and the tour "רשום לסיור" strip) open THIS modal.

function Section({ index, title, active, done, summary, onOpen, children }) {
  return (
    <section className={'rounded-xl border ' + (active ? 'border-blue-300 shadow-sm' : 'border-gray-200')}>
      <button
        type="button"
        onClick={onOpen}
        className={'flex w-full items-center gap-3 px-4 py-3 text-right ' + (active ? 'bg-blue-50/60' : 'hover:bg-gray-50')}
      >
        <span className={'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ' + (done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600')}>
          {done ? '✓' : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-gray-900">{title}</span>
          {!active && summary && <span className="block truncate text-[12.5px] text-gray-500">{summary}</span>}
        </span>
        {!active && <span className="text-[12px] text-blue-600">{done ? 'עריכה' : 'פתח'}</span>}
      </button>
      {active && <div className="border-t border-gray-100 p-4">{children}</div>}
    </section>
  );
}

const dealComplete = (d) => Number(d?.participants) > 0 && (d?.productId || d?.productVariantId);

// The deal's payment-link phone for display: the contact flagged to receive
// payment links, else the primary/first contact, then its primary/first phone.
// The SERVER re-resolves this authoritatively on send — this is only for the UI.
function dealPhone(deal) {
  const list = deal?.contacts || [];
  const dc = list.find((c) => c.receivePaymentLinks) || list[0] || null;
  const phones = dc?.contact?.phones || [];
  const primary = phones.find((p) => p.isPrimary) || phones[0] || null;
  return primary?.value || '';
}

export default function GroupRegistrationModal({ deal, onClose, onChanged, initialSection }) {
  const existingTour = deal.groupRegistration?.tour || (deal.bookings || []).find((b) => b.status === 'active')?.tourEvent || null;
  // Locally-tracked offering summary — updated on inline-builder save so the
  // collapsed Section-1 summary + the completion context reflect the save without
  // waiting for a full parent reload.
  const [savedOffering, setSavedOffering] = useState(
    dealComplete(deal)
      ? { participants: Number(deal.participants) || 0, valueMinor: deal.valueMinor ?? null, productId: deal.productId || null, productVariantId: deal.productVariantId || null, productName: deal.product?.nameHe || null }
      : null,
  );
  const builderDone = !!savedOffering && Number(savedOffering.participants) > 0;
  const [section, setSection] = useState(initialSection || (builderDone ? 2 : 1));
  const [selectedTour, setSelectedTour] = useState(existingTour);
  const [createOpen, setCreateOpen] = useState(false);
  const [tours, setTours] = useState(null);
  const [hasSelection, setHasSelection] = useState(builderDone);
  const [saving, setSaving] = useState(false);
  const [waiverPrompt, setWaiverPrompt] = useState(null); // { added, advance } | null
  const builderRef = useRef(null);

  useEffect(() => {
    if (section !== 2 || tours) return;
    api.tours
      .list({ kind: 'group_slot', statuses: 'scheduled' })
      .then((r) => setTours((r.items || r || []).filter((t) => t.date)))
      .catch(() => setTours([]));
  }, [section, tours]);

  const offeringSummary = builderDone
    ? [savedOffering.productName || deal.product?.nameHe, savedOffering.participants ? `${savedOffering.participants} משתתפים` : null, savedOffering.valueMinor != null ? formatMinor(savedOffering.valueMinor) : null]
        .filter(Boolean)
        .join(' · ')
    : 'טרם הוגדרה עסקה';
  const ctx = {
    productVariantId: savedOffering?.productVariantId || deal.productVariantId || null,
    quantity: Number(savedOffering?.participants) || Number(deal.participants) || 1,
  };

  // Save the inline builder; optionally advance to tour selection. The builder
  // returns the derived offering (participants/value/product) — no recalculation.
  // If the deal is registered without payment and the edit INCREASES tickets, the
  // server returns 409 and we surface the waiver decision dialog, then re-save.
  async function saveBuilder({ advance = false, waiverDecision } = {}) {
    setSaving(true);
    try {
      const r = await builderRef.current?.save(waiverDecision ? { waiverDecision } : {});
      if (r?.ok) {
        setSavedOffering({
          participants: r.participants,
          valueMinor: r.valueMinor,
          productId: r.productId || null,
          productVariantId: r.productVariantId || null,
          productName: savedOffering?.productName || deal.product?.nameHe || null,
        });
        setWaiverPrompt(null);
        onChanged?.();
        if (advance) setSection(2);
      }
    } catch (e) {
      if (e.code === 'waiver_decision_required') {
        setWaiverPrompt({ added: e.added || [], advance }); // remember whether to advance after the decision
        return;
      }
      /* the builder surfaces other errors inline */
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="רישום לסיור קבוצתי" size="lg">
      <div className="space-y-3">
        <Section
          index={1}
          title="פרטי העסקה"
          active={section === 1}
          done={builderDone}
          summary={offeringSummary}
          onOpen={() => setSection(1)}
        >
          <div className="space-y-3">
            {/* The Group Ticket Builder, INLINE (no separate dialog) — narrow +
                compact for group-ticket sales, reusing the shared builder body. */}
            <GroupTicketBuilder ref={builderRef} deal={deal} context={{}} compact onSelectionChange={setHasSelection} />
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
              <button
                type="button"
                disabled={saving || !hasSelection}
                onClick={() => saveBuilder({ advance: false })}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {saving ? 'שומר…' : 'שמור'}
              </button>
              <button
                type="button"
                disabled={saving || !hasSelection}
                onClick={() => saveBuilder({ advance: true })}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'שומר…' : 'שמור ושבץ לסיור'}
              </button>
            </div>
          </div>
        </Section>

        <Section
          index={2}
          title="בחירת סיור"
          active={section === 2}
          done={!!selectedTour}
          summary={selectedTour ? `${fmtTourDate(selectedTour.date)} · ${selectedTour.startTime || ''}` : ''}
          onOpen={() => setSection(2)}
        >
          <div className="space-y-2">
            {tours == null ? (
              <div className="py-4 text-center text-sm text-gray-400">טוען סיורים…</div>
            ) : (
              <ul className="max-h-[40vh] divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                {tours.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-gray-400">אין סיורים מתוכננים — צרו חדש.</li>}
                {tours.map((t) => {
                  const over = t.capacity != null && t.activeSeats > t.capacity;
                  const isSel = selectedTour?.id === t.id;
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => { setSelectedTour(t); setSection(3); }}
                        className={'flex w-full items-center gap-3 px-3 py-2.5 text-right hover:bg-blue-50/50 ' + (isSel ? 'bg-blue-50' : '')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium text-gray-800">
                            {fmtTourDate(t.date)} · <span dir="ltr">{t.startTime}</span>
                          </span>
                          <span className="block text-[12px] text-gray-500">
                            {t.product?.nameHe || '—'}
                            {(t.location?.nameHe || t.productVariant?.location?.nameHe) && ` · ${t.location?.nameHe || t.productVariant?.location?.nameHe}`}
                          </span>
                        </span>
                        <span className={'shrink-0 text-[12.5px] tabular-nums ' + (over ? 'text-red-600' : 'text-gray-500')} dir="ltr">
                          {t.activeSeats} / {t.capacity ?? '—'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-between">
              <button type="button" onClick={() => setCreateOpen(true)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
                + צור סיור חדש
              </button>
            </div>
          </div>
        </Section>

        <Section index={3} title="השלמת ההרשמה" active={section === 3} done={deal.groupRegistration?.state === 'confirmed'} summary="" onOpen={() => selectedTour && setSection(3)}>
          {selectedTour ? (
            <CompletionModes
              deal={deal}
              tourEventId={selectedTour.id}
              phone={dealPhone(deal)}
              context={ctx}
              onDone={() => { onChanged?.(); onClose?.(); }}
            />
          ) : (
            <div className="py-3 text-center text-[13px] text-gray-400">בחרו סיור תחילה.</div>
          )}
        </Section>
      </div>

      {createOpen && (
        <TourSlotModal
          open
          tour={null}
          onClose={() => setCreateOpen(false)}
          onSaved={(saved) => {
            setCreateOpen(false);
            if (saved) {
              setTours((prev) => [saved, ...(prev || [])]);
              setSelectedTour(saved);
              setSection(3);
            }
          }}
        />
      )}
      {waiverPrompt && (
        <WaiverDecisionDialog
          added={waiverPrompt.added}
          busy={saving}
          onDecide={(decision) => saveBuilder({ advance: waiverPrompt.advance, waiverDecision: decision })}
          onCancel={() => setWaiverPrompt(null)}
        />
      )}
    </Dialog>
  );
}
