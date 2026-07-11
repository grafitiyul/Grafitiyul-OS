// Compact history row for a structured Deal change event (TimelineEntry
// kind='change'). Emitted by the backend Deal update paths — one entry per
// save, entry.data.changes = [{ fieldKey, labelHe, oldValue, newValue,
// oldDisplay, newDisplay }]. Lines use the neutral "שדה: ישן ← חדש" format
// (verb-free — Hebrew gender agreement stays correct for every field name).

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-gray-400"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function Val({ v, strong = false }) {
  const empty = v === null || v === undefined || v === '';
  return (
    <span className={empty ? 'text-gray-400' : strong ? 'font-semibold text-gray-900' : 'text-gray-500'}>
      {empty ? 'ללא' : v}
    </span>
  );
}

function ChangeLine({ c }) {
  // Relation events get a verbal line; plain field changes render old ← new.
  if (c.fieldKey === 'contactLinked') {
    return (
      <>
        <span className="text-gray-600">נוסף איש קשר:</span> <Val v={c.newDisplay} strong />
      </>
    );
  }
  if (c.fieldKey === 'contactUnlinked') {
    return (
      <>
        <span className="text-gray-600">הוסר איש קשר:</span> <Val v={c.oldDisplay} strong />
      </>
    );
  }
  return (
    <>
      <span className="text-gray-600">{c.labelHe}:</span> <Val v={c.oldDisplay} />
      <span className="mx-1 text-gray-400" aria-hidden>←</span>
      <Val v={c.newDisplay} strong />
    </>
  );
}

export default function ChangeEventRow({ entry }) {
  const changes = Array.isArray(entry.data?.changes) ? entry.data.changes : [];
  const when = entry.createdAt ? new Date(entry.createdAt) : null;
  const actor = entry.createdByName || entry.actorLabel || 'מערכת';
  // Titled entries (questionnaire history: "טופס X הוגש/עודכן") keep the
  // title as the header and expand ALL changes below it; untitled entries
  // (deal/person changelog) keep the original compact behavior.
  const title = entry.data?.title || null;
  const multi = title ? changes.length > 0 : changes.length > 1;

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2" dir="rtl">
      <div className="flex items-center gap-2">
        <span className="shrink-0 leading-none"><PencilIcon /></span>
        <span className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700 ring-1 ring-blue-200">
          עדכון
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800">
          {title ? (
            <span className="font-medium">{title}</span>
          ) : changes.length > 1 ? (
            <span className="font-medium">{changes.length} שינויים בפרטי הדיל</span>
          ) : changes.length === 1 ? (
            <ChangeLine c={changes[0]} />
          ) : (
            'עדכון פרטים'
          )}
        </span>
        <span className="shrink-0 text-[11px] text-gray-400">
          {when
            ? when.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            : ''}
          {' · '}
          {actor}
        </span>
      </div>
      {multi && (
        <ul className="mt-1.5 space-y-1 pr-7">
          {changes.map((c, i) => (
            <li key={i} className="text-[13px] text-gray-800">
              <ChangeLine c={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
