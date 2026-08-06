import { dealChangeFieldLabel } from '../../../../../shared/dealStatus.mjs';
import EventRowShell from './EventRowShell.jsx';

// Compact history row for a structured Deal change event (TimelineEntry
// kind='change'). Emitted by the backend Deal update paths — one entry per
// save, entry.data.changes = [{ fieldKey, labelHe, oldValue, newValue,
// oldDisplay, newDisplay }]. Lines use the neutral "שדה: ישן ← חדש" format
// (verb-free — Hebrew gender agreement stays correct for every field name).
//
// THE RENDERER OWNS THE LABEL for the lifecycle fields. Entries written before
// the vocabulary was unified stored "סיבת הפסד"; they now DISPLAY "סיבת LOST"
// without a single stored audit row being rewritten. Every other field keeps
// exactly the label it was recorded with.

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

// Reading hierarchy inside a change line: the FIELD NAME and the OLD value are
// context (.gos-detail); the NEW value is the answer, so it inherits the row's
// primary weight instead of being one more grey token in a grey sentence.
function Val({ v, strong = false }) {
  const empty = v === null || v === undefined || v === '';
  if (empty) return <span className="gos-meta">ללא</span>;
  return <span className={strong ? '' : 'gos-detail'}>{v}</span>;
}

function ChangeLine({ c }) {
  // Relation events get a verbal line; plain field changes render old ← new.
  if (c.fieldKey === 'contactLinked') {
    return (
      <>
        <span className="gos-detail">נוסף איש קשר:</span> <Val v={c.newDisplay} strong />
      </>
    );
  }
  if (c.fieldKey === 'contactUnlinked') {
    return (
      <>
        <span className="gos-detail">הוסר איש קשר:</span> <Val v={c.oldDisplay} strong />
      </>
    );
  }
  return (
    <>
      <span className="gos-detail">{dealChangeFieldLabel(c.fieldKey, c.labelHe)}:</span>{' '}
      <Val v={c.oldDisplay} />
      <span className="gos-sep mx-1" aria-hidden>←</span>
      <Val v={c.newDisplay} strong />
    </>
  );
}

export default function ChangeEventRow({ entry }) {
  const changes = Array.isArray(entry.data?.changes) ? entry.data.changes : [];
  // Titled entries (questionnaire history: "טופס X הוגש/עודכן") keep the
  // title as the header and expand ALL changes below it; untitled entries
  // (deal/person changelog) keep the original compact behavior.
  const title = entry.data?.title || null;
  const multi = title ? changes.length > 0 : changes.length > 1;

  return (
    <EventRowShell
      icon={<PencilIcon />}
      chip={{ label: 'עדכון', tone: 'bg-blue-50 text-blue-700 ring-blue-200' }}
      when={entry.createdAt}
      actor={entry.createdByName || entry.actorLabel || 'מערכת'}
      below={
        multi ? (
          <ul className="gos-stack mt-2 border-t border-gray-100 pr-7 pt-2">
            {changes.map((c, i) => (
              <li key={i} className="gos-subject">
                <ChangeLine c={c} />
              </li>
            ))}
          </ul>
        ) : null
      }
    >
      {title || (changes.length > 1
        ? `${changes.length} שינויים בפרטי הדיל`
        : changes.length === 1
          ? <ChangeLine c={changes[0]} />
          : 'עדכון פרטים')}
    </EventRowShell>
  );
}
