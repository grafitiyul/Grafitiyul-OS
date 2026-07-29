import Card from '../common/PanelCard.jsx';

// "שיווק ומקור הליד" — THE permanent marketing card on the Deal right panel.
//
// This is deliberately NOT a migration panel. Today its data comes from the
// Pipedrive import; once a source moves to direct ingress the ingress platform
// writes the same canonical fields, and this component does not change. That is
// the whole design goal — cutover must be a change of writer, never a change of
// UI.
//
// The server sends a business-language DTO (marketingDto): ordered groups of
// label/value rows, with empty groups already removed. The client renders what
// it is given and never re-derives, re-labels or re-orders — so the panel and
// the ownership contract cannot drift apart.

const isUrl = (v) => /^https?:\/\//i.test(String(v || ''));

// URLs get LTR + truncation; everything else uses dir="auto" so Hebrew labels
// and Latin campaign codes each align the way they should inside an RTL panel.
function Value({ value }) {
  if (isUrl(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        title={value}
        dir="ltr"
        className="text-[13px] text-blue-700 hover:underline truncate max-w-[15rem] inline-block align-bottom"
      >
        {value.replace(/^https?:\/\//i, '').slice(0, 44)}
        {value.replace(/^https?:\/\//i, '').length > 44 ? '…' : ''}
      </a>
    );
  }
  return (
    <span dir="auto" className="text-[13px] text-gray-900 break-words">
      {value}
    </span>
  );
}

export default function MarketingCard({ marketing }) {
  // No marketing information at all → render nothing, rather than a card full
  // of dashes. An empty card is worse than no card.
  if (!marketing?.hasAny) return null;

  return (
    <Card variant="panel" title="שיווק ומקור הליד">
      {marketing.syncedFromLegacy && (
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800 ring-1 ring-amber-200/70">
          <span aria-hidden="true">⟳</span>
          מסונכרן ממערכת קודמת
        </div>
      )}

      <div className="space-y-3.5">
        {marketing.groups.map((group, gi) => (
          <div key={group.key}>
            {/* The first group carries the card title, so it needs no heading of
                its own — repeating "מקור הליד" under "שיווק ומקור הליד" is noise. */}
            {gi > 0 && (
              <div className="mb-1.5 text-[11px] font-medium text-gray-400">{group.title}</div>
            )}
            <dl className="space-y-1.5">
              {group.rows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-[13px] text-gray-500">{row.label}</dt>
                  <dd className="text-right">
                    <Value value={row.value} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}
