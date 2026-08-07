import { money, fmtWhen, STATUS_HE, BLOCKER_HE } from './mergeFormat.js';

// The final review.
//
// Two halves, deliberately unequal in weight:
//   • what the merged deal WILL BE — the outcome, read as facts
//   • what happens to the OTHER deal — spelled out, never softened
//
// The destructive consequences are not hidden behind a summary line. An
// operator about to retire a deal should read exactly what that means before
// they can click the button, and the button itself is red for the same reason.
//
// Every number and every sentence here comes from the server's preview. This
// component computes nothing.

export default function MergeFinalReview({ preview, loading }) {
  if (loading && !preview) return <div className="py-6 text-center text-sm text-gray-500">מחשב…</div>;
  if (!preview) return null;

  const s = preview.survivor;
  const o = preview.other;
  const m = preview.money;
  const op = preview.operational;
  const overpaid = m.overpaidMinor > 0;

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      {/* ── the outcome ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
        <h4 className="text-[13px] font-semibold text-emerald-900">
          הדיל שנשאר — #{s.orderNo}
        </h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Fact label="סטטוס" value={STATUS_HE[preview.status.value] || preview.status.value} />
          <Fact label="איש קשר ראשי" value={primaryName(preview)} />
          <Fact label="אנשי קשר" value={`${preview.contacts.links.length}${preview.contacts.addedCount ? ` (+${preview.contacts.addedCount})` : ''}`} />
          <Fact label="ארגון" value={orgAfter(preview)} />
          <Fact label="מוצר / עיר" value={s.variantName || s.productName || '—'} />
          <Fact label="מועד" value={s.tourDate ? `${s.tourDate}${s.tourTime ? ` · ${s.tourTime}` : ''}` : '—'} />
          <Fact label="משתתפים" value={preview.participants.value ?? '—'} />
          <Fact label="סכום הדיל" value={money(m.mergedTotalMinor, m.currency)} />
          <Fact label="שולם (שני הדילים)" value={money(m.combinedPaidMinor, m.currency)} />
          <Fact
            label={overpaid ? 'יתרת זכות' : 'יתרה לתשלום'}
            value={money(Math.abs(m.mergedBalanceMinor), m.currency)}
            tone={overpaid ? 'credit' : m.mergedBalanceMinor > 0 ? 'due' : 'ok'}
          />
          <Fact label="סיור" value={tourAfter(op)} />
          <Fact label="משימות פתוחות" value={openTasksAfter(preview)} />
        </dl>
      </section>

      {/* ── what happens to the other deal ─────────────────────────────── */}
      <section className="rounded-xl border border-red-200 bg-red-50/40 p-3">
        <h4 className="text-[13px] font-semibold text-red-900">מה יקרה לדיל #{o.orderNo}</h4>
        <ul className="mt-1.5 space-y-1 text-[12.5px] text-gray-700">
          <li>• יסומן כמאוחד לתוך דיל #{s.orderNo} ולא יופיע יותר כדיל עצמאי — לא ברשימות, לא בגבייה, לא בבקרה.</li>
          <li>• <b>לא יימחק.</b> הרשומה נשארת, מספר ההזמנה שלו נשמר לתמיד ואף פעם לא ימוחזר.</li>
          <li>• כניסה לכתובת שלו תציג שהוא אוחד, עם קישור לדיל הפעיל.</li>
          <li>• חיפוש לפי מספר #{o.orderNo}, שם הלקוח או הטלפון ימשיך למצוא אותו ויוביל לדיל #{s.orderNo}.</li>
          <li>• לא ניתן יהיה לערוך אותו יותר — כל שינוי נעשה בדיל #{s.orderNo}.</li>
          <li>
            • כל התשלומים, הקבלות והחשבוניות שלו
            {m.other.documentCount ? ` (${m.other.documentCount} רשומות)` : ''} נשארים רשומים עליו לצורכי ביקורת,
            ומוצגים בדיל המאוחד.
          </li>
          <li>• ההיסטוריה שלו — הערות, מיילים, וואטסאפ, שינויים ואירועים — תוצג בדיל #{s.orderNo} בסדר כרונולוגי אחד, מסומנת "במקור מדיל #{o.orderNo}".</li>
        </ul>
      </section>

      {/* ── the ordered plan ───────────────────────────────────────────── */}
      <section>
        <h4 className="mb-1.5 text-[12px] font-semibold text-gray-500">מה בדיוק יקרה</h4>
        <ol className="list-decimal space-y-1 rounded-xl border border-gray-200 p-3 pr-7 text-[12.5px] text-gray-700">
          {preview.plan.map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      </section>

      {overpaid && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <b>ייפתח כרטיס טיפול:</b> הסכום ששולם ({money(m.combinedPaidMinor, m.currency)}) גבוה מהסכום המשולב
          ({money(m.mergedTotalMinor, m.currency)}). לא יופק זיכוי ולא יבוצע החזר אוטומטית — ההחלטה החשבונאית שלך.
        </div>
      )}

      {preview.warnings?.length > 0 && (
        <ul className="space-y-1">
          {preview.warnings.map((w, i) => (
            <li key={i} className="rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] text-blue-800">{w.messageHe}</li>
          ))}
        </ul>
      )}

      {preview.blockers?.length > 0 && (
        <ul className="space-y-1">
          {preview.blockers.map((b, i) => (
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
    </div>
  );
}

function primaryName(preview) {
  const id = preview.contacts.primaryContactId;
  return preview.contacts.people.find((p) => p.contactId === id)?.name || '—';
}

function orgAfter(preview) {
  const f = preview.fields.find((x) => x.key === 'organizationId');
  if (!f) return preview.survivor.organizationName || '—';
  const fromOther = f.resolution === 'other_only' || (f.resolution === 'conflict' && f.choice === 'other');
  return (fromOther ? preview.other.organizationName : preview.survivor.organizationName) || '—';
}

function tourAfter(op) {
  if (op.mode === 'none') return 'ללא שיבוץ';
  if (op.mode === 'adopt_other' || op.mode === 'adopt_other_tour') return fmtWhen(op.otherTour);
  return fmtWhen(op.survivorTour);
}

function openTasksAfter(preview) {
  const decisions = preview.tasks.other;
  const moved = decisions.length; // default is 'move'; the decisions step overrides per task
  return `${preview.tasks.survivor.length}${moved ? ` (+עד ${moved} מהדיל השני)` : ''}`;
}

const TONE = { credit: 'text-amber-700', due: 'text-red-600', ok: 'text-emerald-700' };

function Fact({ label, value, tone }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className={`truncate text-[13px] font-medium ${TONE[tone] || 'text-gray-800'}`}>{value}</dd>
    </div>
  );
}
