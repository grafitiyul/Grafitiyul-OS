import { money, fmtWhen, STATUS_HE, TOUR_KIND_HE, BLOCKER_HE } from './mergeFormat.js';
import PhoneDisplay from '../../common/PhoneDisplay.jsx';

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

  const openBlockers = preview.blockers || [];

  return (
    <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
      {!anyQuestion && !openBlockers.length && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
          אין התנגשויות שדורשות הכרעה. אפשר לעבור לסקירה הסופית.
        </div>
      )}

      {/* WHAT is still open, at the top of the step where the decisions are.
          Without it the operator meets a disabled "המשך" and has to hunt the
          screen for the reason — the blockers were only listed on the final
          review, which is the one place they cannot get to. */}
      {openBlockers.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-amber-900">
            נותרו {openBlockers.length} החלטות להשלמה:
          </div>
          <ul className="mt-1 space-y-0.5 text-[12px] text-amber-800">
            {openBlockers.map((b, i) => (
              <li key={i}>
                • {BLOCKER_HE[b.code] || b.code}
                {b.fields?.length ? `: ${b.fields.map((f) => f.labelHe).join(', ')}` : ''}
              </li>
            ))}
          </ul>
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
        title="איש הקשר הראשי"
        hint={
          `כל אנשי הקשר משני הדילים יישמרו ויקושרו לדיל המאוחד${contacts.addedCount ? ` (${contacts.addedCount} מהם חדשים בדיל שנשאר)` : ''}. `
          + 'הבחירה כאן היא מי יהיה איש הקשר הראשי — אף איש קשר לא נמחק, ואנשי קשר לא מאוחדים זה לזה.'
        }
      >
        <div className="space-y-1.5">
          {contacts.people.map((p) => {
            const on = contacts.primaryContactId === p.contactId;
            return (
              <label
                key={p.contactId}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition ${
                  on ? 'border-gray-800 bg-gray-50 ring-1 ring-gray-800' : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="primaryContact"
                  className="mt-1"
                  checked={on}
                  onChange={() => onPatch({ primaryContactId: p.contactId })}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-gray-900">{p.name}</span>
                    {on && <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">ראשי</span>}
                  </span>
                  <ContactIdentity person={p} />
                </span>
              </label>
            );
          })}
        </div>
      </Block>

      {/* ── field conflicts ────────────────────────────────────────────── */}
      {fieldConflicts.length > 0 && (
        <Block
          title="שדות סותרים"
          hint="בשני הדילים יש ערך שונה. יש לבחור מה נכון לעסקה המאוחדת."
        >
          <div className="space-y-2">
            {/* An UNANSWERED row shows NEITHER option selected.
                It used to pre-select the survivor's side, which made a row that
                still blocked the merge look already decided — the operator saw
                a chosen value, a disabled "המשך", and no way to tell which row
                wanted attention. The default value is still the survivor's (the
                server resolves it that way); what changed is that the SCREEN no
                longer claims a decision the operator has not made. */}
            {fieldConflicts.map((f) => {
              const answered = decisions.fields?.[f.key];
              return (
                <div
                  key={f.key}
                  className={`rounded-lg border p-2 ${answered ? 'border-gray-200' : 'border-amber-300 bg-amber-50/40'}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-gray-700">{f.labelHe}</span>
                    {!answered && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        טרם נבחר
                      </span>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <MiniChoice
                      on={answered === 'survivor'}
                      onClick={() => onPatch({ fields: { ...(decisions.fields || {}), [f.key]: 'survivor' } })}
                      text={<FieldValue display={f.survivorDisplay} long={f.survivorDisplay?.long} />}
                      sub={`מדיל #${preview.survivor.orderNo}`}
                      title={fullValueTitle(f.survivorDisplay)}
                    />
                    <MiniChoice
                      on={answered === 'other'}
                      onClick={() => onPatch({ fields: { ...(decisions.fields || {}), [f.key]: 'other' } })}
                      text={<FieldValue display={f.otherDisplay} long={f.otherDisplay?.long} />}
                      sub={`מדיל #${preview.other.orderNo}`}
                      title={fullValueTitle(f.otherDisplay)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Block>
      )}

      {autoResolvedFields.length > 0 && (
        <Auto title="שדות שהושלמו אוטומטית">
          <span className="block">
            שדות שהיו ריקים בדיל שנשאר יתמלאו מדיל #{preview.other.orderNo}:
          </span>
          {/* The VALUE, not just the field name. Nothing is being asked here,
              but the operator is about to confirm a merge and has a right to
              see what will land — without opening the other deal. */}
          <ul className="mt-1 space-y-0.5">
            {autoResolvedFields.map((f) => (
              <li key={f.key} className="text-gray-600">
                <span className="text-gray-400">{f.labelHe}:</span>{' '}
                <FieldValue display={f.otherDisplay} long={f.otherDisplay?.long} />
              </li>
            ))}
          </ul>
        </Auto>
      )}

      {/* ── tasks ──────────────────────────────────────────────────────── */}
      {tasks.other.length > 0 && (
        <Block
          title="משימות פתוחות בדיל השני"
          hint="משימות פתוחות הן עבודה שעוד צריך לעשות, ולכן הן עוברות לדיל שנשאר. משימה אוטומטית שכבר קיימת בדיל שנשאר תיסגר ככפילות — אפשר לשנות כל שורה."
        >
          <div className="space-y-1">
            {tasks.other.map((t) => {
              // The server's per-task suggestion (mergeResolve.suggestTaskActions):
              // 'move' for real work, 'close_duplicate' where the survivor
              // already has an open task of the same type.
              const s = (tasks.suggestions || []).find((x) => x.id === t.id);
              const value = decisions.tasks?.[t.id] || s?.suggested || 'move';
              return (
              <div key={t.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-800">
                  {t.title}
                  {s?.duplicate && (
                    <span
                      className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                      title={s.reasonHe || undefined}
                    >
                      כפילות
                    </span>
                  )}
                </span>
                <select
                  value={value}
                  onChange={(e) => onPatch({ tasks: { ...(decisions.tasks || {}), [t.id]: e.target.value } })}
                  className="rounded border border-gray-300 px-2 py-1 text-[12px]"
                >
                  <option value="move">להעביר לדיל שנשאר</option>
                  <option value="close_duplicate">לסגור ככפילות</option>
                  <option value="keep">להשאיר בדיל המאוחד</option>
                </select>
              </div>
              );
            })}
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

// The value the operator is actually choosing between.
//
// The SERVER resolves every stored id into its catalog label
// (deals/mergeFieldLabels.js) precisely so this component never has to describe
// a value it cannot read — "ערך אחר" beside a deal number is not a choice
// anyone can make. An empty value says so explicitly: choosing "nothing" is a
// real answer to a merge question and must not look like a missing label.
function FieldValue({ display, long }) {
  if (!display || (display.label === null && !display.missing)) {
    return <span className="text-gray-400">לא הוגדר</span>;
  }
  if (display.missing) {
    return <span className="text-amber-700">{display.label}</span>;
  }
  const text = String(display.label);
  const isLong = long && text.length > 60;
  return (
    <span className="text-gray-800" title={isLong ? text : undefined}>
      {isLong ? `${text.slice(0, 60)}…` : text}
      {display.hint && <span className="mr-1 text-[11px] font-normal text-gray-400">({display.hint})</span>}
    </span>
  );
}

// Enough to tell two people with the SAME NAME apart — which is exactly the
// case a merge produces — without turning the row into a full contact record.
//
// Phones render through the canonical PhoneDisplay (flag + the Israeli-local
// display convention), the same component the contacts table and contact page
// use, so a number never looks different here than everywhere else.
const MAX_SHOWN = 2;

function ContactIdentity({ person }) {
  const extraPhones = Math.max(0, (person.phones?.length || 0) - MAX_SHOWN);
  const extraEmails = Math.max(0, (person.emails?.length || 0) - MAX_SHOWN);
  const orgs = person.organizations || [];
  const nothing = !person.phones?.length && !person.emails?.length && !orgs.length;

  return (
    <span className="mt-0.5 block space-y-0.5 text-[11.5px] text-gray-600">
      {(person.phones || []).slice(0, MAX_SHOWN).map((v) => (
        <span key={v} className="block"><PhoneDisplay value={v} /></span>
      ))}
      {extraPhones > 0 && <span className="block text-gray-400">ועוד {extraPhones} מספרי טלפון</span>}

      {(person.emails || []).slice(0, MAX_SHOWN).map((v) => (
        <span key={v} className="block truncate" dir="ltr">{v}</span>
      ))}
      {extraEmails > 0 && <span className="block text-gray-400">ועוד {extraEmails} כתובות אימייל</span>}

      {orgs.length > 0 && <span className="block">ארגון: {orgs.slice(0, 2).join(', ')}{orgs.length > 2 ? ` ועוד ${orgs.length - 2}` : ''}</span>}
      {nothing && <span className="block text-gray-400">אין טלפון או אימייל</span>}

      {/* Provenance last and quietest — it explains where the person came from,
          it is not what the operator is choosing between. */}
      <span className="block text-gray-400">
        {person.onDeals.length > 1
          ? `מופיע בשני הדילים (#${person.onDeals.join(', #')})`
          : `מדיל #${person.onDeals[0]}`}
        {person.wasPrimaryOn?.length ? ` · ראשי בדיל #${person.wasPrimaryOn.join(', #')}` : ''}
      </span>
    </span>
  );
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

function Auto({ title, text, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <h4 className="text-[12.5px] font-semibold text-gray-700">{title}</h4>
      <div className="mt-0.5 text-[12px] text-gray-500">{children || text}</div>
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

// A truncated value must still be INSPECTABLE, and hovering anywhere on the
// card is the discoverable place to do it — not just the few characters of
// text. Undefined for short values, so no tooltip repeats what is on screen.
function fullValueTitle(display) {
  if (!display?.long || !display.label) return undefined;
  const text = String(display.label);
  return text.length > 60 ? text : undefined;
}

function MiniChoice({ on, onClick, text, sub, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg border px-2 py-1.5 text-right transition ${
        on ? 'border-gray-800 bg-gray-50 ring-1 ring-gray-800' : 'border-gray-300 bg-white hover:bg-gray-50'
      }`}
    >
      {/* The VALUE leads and the deal number is secondary metadata below it —
          the operator is choosing a value, not a deal. */}
      <div className="text-[12.5px] font-medium">{text}</div>
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
