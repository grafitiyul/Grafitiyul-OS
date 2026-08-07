import { money, fmtWhen, STATUS_HE, TOUR_KIND_HE } from './mergeFormat.js';

// The decisions step.
//
// The governing rule: the operator is asked ONLY about genuine conflicts.
// Everywhere one deal is empty and the other is not, or both agree, the server
// resolved it already and this screen REPORTS it instead of asking. A screen
// that asks thirty questions to get to the two that matter trains people to
// click through it, and the two that matter are the ones that move money and
// seats.
//
// Every section here is rendered only when the server's preview says a decision
// is genuinely open (`needsChoice`) — this component never decides that itself.

export default function MergeDecisions({ preview, decisions, onPatch, loading }) {
  if (!preview) return null;
  const { commercial, participants, status, operational, fieldConflicts, autoResolvedFields, contacts, tasks } = preview;

  const anyQuestion =
    commercial.needsChoice || participants.needsChoice || operational.needsChoice
    || status.needsChoice || fieldConflicts.length > 0;

  return (
    <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
      {!anyQuestion && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          אין התנגשויות שדורשות הכרעה. אפשר לעבור לסקירה הסופית.
        </div>
      )}

      {/* ── commercial ─────────────────────────────────────────────────── */}
      {commercial.situation === 'both_meaningful' ? (
        <Block
          title="מחיר ובילדר"
          hint="בשני הדילים יש תוכן מסחרי אמיתי. הסכומים לא מחוברים אוטומטית — צריך להחליט."
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Choice
              on={decisions.commercial === 'survivor'}
              onClick={() => onPatch({ commercial: 'survivor', commercialLineIds: undefined })}
              title={`של דיל #${preview.survivor.orderNo}`}
              body={`${money(preview.survivor.valueMinor, preview.survivor.currency)} · ${preview.survivor.builderLineCount} שורות`}
            />
            <Choice
              on={decisions.commercial === 'other'}
              onClick={() => onPatch({ commercial: 'other', commercialLineIds: undefined })}
              title={`של דיל #${preview.other.orderNo}`}
              body={`${money(preview.other.valueMinor, preview.other.currency)} · ${preview.other.builderLineCount} שורות`}
            />
            <Choice
              on={decisions.commercial === 'combine'}
              onClick={() => onPatch({ commercial: 'combine' })}
              title="שילוב"
              body="בחירת השורות שיישארו משני הדילים"
            />
          </div>

          {decisions.commercial === 'combine' && (
            <LineChooser
              candidates={commercial.candidates}
              selected={commercial.selectedLineIds}
              currency={preview.survivor.currency}
              onChange={(ids) => onPatch({ commercialLineIds: ids })}
            />
          )}

          {commercial.resolution && (
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
              סה"כ הדיל המאוחד: <b>{money(commercial.mergedTotalMinor, preview.survivor.currency)}</b>
              {commercial.demotedProductLines > 0 && (
                <span className="block text-[11px] text-gray-500">
                  {commercial.demotedProductLines} שורות מוצר מהדיל השני נשמרות במחיר הקפוא שלהן, כדי שלא יתומחרו מחדש ולא ייספרו פעמיים.
                </span>
              )}
            </p>
          )}
        </Block>
      ) : (
        commercial.situation !== 'both_empty' && (
          <Auto
            title="מחיר ובילדר"
            text={
              commercial.situation === 'other_only'
                ? `רק לדיל #${preview.other.orderNo} יש תוכן מסחרי — הוא ייבחר אוטומטית (${money(commercial.mergedTotalMinor, preview.survivor.currency)}).`
                : `רק לדיל #${preview.survivor.orderNo} יש תוכן מסחרי — הוא נשמר כפי שהוא (${money(commercial.mergedTotalMinor, preview.survivor.currency)}).`
            }
          />
        )
      )}

      {/* ── participants ───────────────────────────────────────────────── */}
      {participants.resolution === 'conflict' ? (
        <Block
          title="מספר משתתפים"
          hint="לשני הדילים מספרי משתתפים שונים. חיבור אינו ברירת מחדל — לרוב מדובר באותם אנשים שנרשמו פעמיים."
        >
          <div className="grid gap-2 sm:grid-cols-4">
            <Choice on={decisions.participants === 'survivor'} onClick={() => onPatch({ participants: 'survivor' })}
              title={`${participants.options.survivor}`} body={`מדיל #${preview.survivor.orderNo}`} />
            <Choice on={decisions.participants === 'other'} onClick={() => onPatch({ participants: 'other' })}
              title={`${participants.options.other}`} body={`מדיל #${preview.other.orderNo}`} />
            <Choice on={decisions.participants === 'combined'} onClick={() => onPatch({ participants: 'combined' })}
              title={`${participants.options.combined}`} body="סכום השניים" />
            <div className={`rounded-xl border p-3 ${decisions.participants === 'custom' ? 'border-gray-800 ring-1 ring-gray-800' : 'border-gray-300'}`}>
              <div className="text-sm font-semibold text-gray-800">מספר אחר</div>
              <input
                type="number"
                min="0"
                value={decisions.participantsCustom ?? ''}
                onChange={(e) => onPatch({ participants: 'custom', participantsCustom: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          {participants.value != null && (
            <p className="mt-2 text-[11.5px] text-gray-500">
              המספר הזה יעדכן גם את המקומות בסיור המשובץ, אם קיים.
            </p>
          )}
        </Block>
      ) : (
        participants.resolution !== 'both_empty' && (
          <Auto title="מספר משתתפים" text={autoParticipantsText(participants, preview)} />
        )
      )}

      {/* ── operational ────────────────────────────────────────────────── */}
      {operational.situation.startsWith('both_live') && (
        <Block
          title="שיבוץ לסיור"
          hint={
            operational.sameTour
              ? 'שני הדילים משובצים לאותו סיור. צריך להחליט אם המקומות מתאחדים או שנשמר רק השיבוץ של הדיל שנשאר.'
              : 'שני הדילים משובצים לסיורים שונים. אחרי האיחוד יכול להישאר רק שיבוץ אחד — הבחירה כאן קובעת איזה, והשני ישוחרר.'
          }
          tone="danger"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <TourCard label={`הסיור של דיל #${preview.survivor.orderNo}`} tour={operational.survivorTour} />
            <TourCard label={`הסיור של דיל #${preview.other.orderNo}`} tour={operational.otherTour} />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {operational.options.includes('merge_seats') && (
              <Choice on={decisions.operational === 'merge_seats'} onClick={() => onPatch({ operational: 'merge_seats' })}
                title="לאחד את המקומות" body="נשארת הזמנה אחת בדיל שנשאר, עם המקומות של שני הדילים." />
            )}
            {operational.options.includes('keep_survivor_tour') && (
              <Choice on={decisions.operational === 'keep_survivor_tour'} onClick={() => onPatch({ operational: 'keep_survivor_tour' })}
                title={`להשאיר את הסיור של #${preview.survivor.orderNo}`}
                body={`ההזמנה של דיל #${preview.other.orderNo} תבוטל והמקומות שלה ישוחררו.`} />
            )}
            {operational.options.includes('adopt_other_tour') && (
              <Choice on={decisions.operational === 'adopt_other_tour'} onClick={() => onPatch({ operational: 'adopt_other_tour' })}
                title={`לעבור לסיור של #${preview.other.orderNo}`}
                body={`ההזמנה הנוכחית של דיל #${preview.survivor.orderNo} תבוטל, והשיבוץ של הדיל השני יעבור אליו.`} />
            )}
          </div>
          {operational.capacity && !operational.capacity.fits && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
              אין מספיק מקום: קיבולת {operational.capacity.capacity}, תפוסה {operational.capacity.activeSeats}, נדרשים {operational.capacity.requested}.
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={!!decisions.allowOverbook} onChange={(e) => onPatch({ allowOverbook: e.target.checked })} />
                <span>לשבץ בכל זאת, מעל הקיבולת</span>
              </label>
            </p>
          )}
        </Block>
      )}
      {operational.situation === 'other_only' && (
        <Auto
          title="שיבוץ לסיור"
          text={`השיבוץ והמקומות של דיל #${preview.other.orderNo} (${fmtWhen(operational.otherTour)}) יעברו לדיל שנשאר — אותם מקומות, אותו סיור, בלי ביטול ויצירה מחדש.`}
        />
      )}
      {operational.situation === 'survivor_only' && (
        <Auto title="שיבוץ לסיור" text={`הסיור של דיל #${preview.survivor.orderNo} (${fmtWhen(operational.survivorTour)}) נשמר ללא שינוי.`} />
      )}

      {/* ── status ─────────────────────────────────────────────────────── */}
      {status.needsChoice && (
        <Block
          title="סטטוס הדיל המאוחד"
          hint={`הדילים בסטטוסים שונים (${STATUS_HE[status.survivorStatus]} ו-${STATUS_HE[status.otherStatus]}). ברירת המחדל שומרת על המצב העסקי האמיתי.`}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            {['won', 'open', 'lost'].map((s) => (
              <Choice
                key={s}
                on={(decisions.status || status.suggested) === s}
                onClick={() => onPatch({ status: s })}
                title={STATUS_HE[s]}
                body={s === status.suggested ? 'ברירת מחדל — המצב העסקי האמיתי' : ''}
              />
            ))}
          </div>
          {status.triggersWonTransition && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              הדיל ייסגר כ-WON כחלק מהאיחוד. תהליכי סגירת דיל (הודעות, דוחות) יופעלו פעם אחת בלבד.
            </p>
          )}
        </Block>
      )}

      {/* ── primary contact ────────────────────────────────────────────── */}
      <Block
        title="אנשי קשר"
        hint={`כל אנשי הקשר משני הדילים יקושרו לדיל שנשאר${contacts.addedCount ? ` (${contacts.addedCount} חדשים)` : ''}. אנשי קשר עצמם לא נמחקים ולא מאוחדים.`}
      >
        <div className="space-y-1">
          {contacts.people.map((p) => (
            <label key={p.contactId} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px]">
              <input
                type="radio"
                name="primaryContact"
                checked={contacts.primaryContactId === p.contactId}
                onChange={() => onPatch({ primaryContactId: p.contactId })}
              />
              <span className="flex-1 text-gray-800">{p.name}</span>
              {contacts.primaryContactId === p.contactId && (
                <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">ראשי</span>
              )}
            </label>
          ))}
        </div>
      </Block>

      {/* ── field conflicts ────────────────────────────────────────────── */}
      {fieldConflicts.length > 0 && (
        <Block title="שדות סותרים" hint="בשני הדילים יש ערך שונה. יש לבחור מה נכון לעסקה המאוחדת.">
          <div className="space-y-2">
            {fieldConflicts.map((f) => (
              <div key={f.key} className="rounded-lg border border-gray-200 p-2">
                <div className="mb-1 text-[12px] font-semibold text-gray-700">{f.labelHe}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <MiniChoice
                    on={(decisions.fields?.[f.key] || 'survivor') === 'survivor'}
                    onClick={() => onPatch({ fields: { ...(decisions.fields || {}), [f.key]: 'survivor' } })}
                    text={displayFieldValue(f, 'survivor', preview)}
                    sub={`דיל #${preview.survivor.orderNo}`}
                  />
                  <MiniChoice
                    on={decisions.fields?.[f.key] === 'other'}
                    onClick={() => onPatch({ fields: { ...(decisions.fields || {}), [f.key]: 'other' } })}
                    text={displayFieldValue(f, 'other', preview)}
                    sub={`דיל #${preview.other.orderNo}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </Block>
      )}

      {autoResolvedFields.length > 0 && (
        <Auto
          title="שדות שהושלמו אוטומטית"
          text={`שדות שהיו ריקים בדיל שנשאר יתמלאו מהדיל השני: ${autoResolvedFields.map((f) => f.labelHe).join(', ')}.`}
        />
      )}

      {/* ── tasks ──────────────────────────────────────────────────────── */}
      {tasks.other.length > 0 && (
        <Block
          title="משימות פתוחות בדיל השני"
          hint="משימות פתוחות הן עבודה שעוד צריך לעשות. ברירת המחדל מעבירה אותן לדיל שנשאר — אף משימה לא משוכפלת."
        >
          <div className="space-y-1">
            {tasks.other.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800">{t.title}</span>
                <select
                  value={decisions.tasks?.[t.id] || 'move'}
                  onChange={(e) => onPatch({ tasks: { ...(decisions.tasks || {}), [t.id]: e.target.value } })}
                  className="rounded border border-gray-300 px-2 py-1 text-[12px]"
                >
                  <option value="move">להעביר לדיל שנשאר</option>
                  <option value="close_duplicate">לסגור ככפילות</option>
                  <option value="keep">להשאיר בדיל המאוחד</option>
                </select>
              </div>
            ))}
          </div>
        </Block>
      )}
    </div>
  );
}

function autoParticipantsText(p, preview) {
  if (p.resolution === 'equal') return `שני הדילים על ${p.value} משתתפים — נשאר ${p.value}.`;
  if (p.resolution === 'other_only') return `בדיל שנשאר לא הוזנו משתתפים — יילקח ${p.value} מדיל #${preview.other.orderNo}.`;
  return `רק בדיל שנשאר הוזנו משתתפים — נשאר ${p.value}.`;
}

// Conflicting values are shown in BUSINESS language wherever the preview
// carries a label for them; a raw id is never rendered (product standard 9).
// Falls back to the value itself for plain scalars (dates, languages, text).
function displayFieldValue(f, side, preview) {
  const raw = side === 'survivor' ? f.survivorValue : f.otherValue;
  const s = side === 'survivor' ? preview.survivor : preview.other;
  const byKey = {
    organizationId: s.organizationName,
    productId: s.productName,
    productVariantId: s.variantName,
    locationId: s.variantName,
    activityType: { group: 'קבוצתי', private: 'פרטי', business: 'עסקי' }[raw],
  };
  const label = byKey[f.key];
  if (label) return label;
  if (raw === null || raw === undefined || raw === '') return '— ריק —';
  // An unresolvable id is described rather than exposed.
  return typeof raw === 'string' && /^c[a-z0-9]{20,}$/.test(raw) ? 'ערך אחר' : String(raw);
}

function Block({ title, hint, tone, children }) {
  return (
    <section className={`rounded-xl border p-3 ${tone === 'danger' ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
      <h4 className="text-[13px] font-semibold text-gray-900">{title}</h4>
      {hint && <p className="mb-2 mt-0.5 text-[12px] text-gray-500">{hint}</p>}
      {children}
    </section>
  );
}

function Auto({ title, text }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <h4 className="text-[12.5px] font-semibold text-gray-700">{title}</h4>
      <p className="mt-0.5 text-[12px] text-gray-500">{text}</p>
    </section>
  );
}

function Choice({ on, onClick, title, body }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-right transition ${
        on ? 'border-gray-800 bg-gray-50 ring-1 ring-gray-800' : 'border-gray-300 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="text-sm font-semibold text-gray-800">{title}</div>
      {body && <div className="mt-0.5 text-[12px] text-gray-500">{body}</div>}
    </button>
  );
}

function MiniChoice({ on, onClick, text, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2 py-1.5 text-right transition ${
        on ? 'border-gray-800 bg-gray-50 ring-1 ring-gray-800' : 'border-gray-300 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="truncate text-[12.5px] font-medium text-gray-800">{text}</div>
      <div className="text-[11px] text-gray-400">{sub}</div>
    </button>
  );
}

function TourCard({ label, tour }) {
  if (!tour) return <div className="rounded-xl border border-gray-200 p-3 text-[12px] text-gray-400">{label}: אין שיבוץ</div>;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-[13px] font-semibold text-gray-800">{TOUR_KIND_HE[tour.kind] || tour.kind}</div>
      <div className="text-[12px] text-gray-600">{fmtWhen(tour)}</div>
      <div className="mt-1 text-[11.5px] text-gray-500">
        {tour.registrationSeats} מקומות
        {tour.capacity != null ? ` · קיבולת ${tour.capacity}` : ''}
      </div>
    </div>
  );
}

// Line-level composition for "שילוב". Duplicates arrive UNSELECTED from the
// server (structural identity, never label text), so double-counting a line
// requires a deliberate tick rather than an oversight.
function LineChooser({ candidates, selected, currency, onChange }) {
  const set = new Set(selected || []);
  const toggle = (id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };
  const rows = candidates.filter((c) => c.selectable);
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[480px] text-[12px]">
        <thead>
          <tr className="bg-gray-50 text-gray-500">
            <th className="w-8 px-2 py-1.5" />
            <th className="px-2 py-1.5 text-right font-medium">שורה</th>
            <th className="px-2 py-1.5 text-right font-medium">מקור</th>
            <th className="px-2 py-1.5 text-right font-medium">כמות</th>
            <th className="px-2 py-1.5 text-left font-medium">סכום</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={`border-t border-gray-100 ${c.duplicate ? 'bg-amber-50/50' : ''}`}>
              <td className="px-2 py-1.5">
                <input type="checkbox" checked={set.has(c.id)} onChange={() => toggle(c.id)} />
              </td>
              <td className="px-2 py-1.5 text-gray-800">
                {c.label || '(ללא תיאור)'}
                {c.duplicate && <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">כפילות אפשרית</span>}
              </td>
              <td className="px-2 py-1.5 text-gray-500">{c.from === 'survivor' ? 'הדיל שנשאר' : 'הדיל השני'}</td>
              <td className="px-2 py-1.5 text-gray-600">{c.quantity}</td>
              <td className="px-2 py-1.5 text-left text-gray-800">{money(c.amountMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
