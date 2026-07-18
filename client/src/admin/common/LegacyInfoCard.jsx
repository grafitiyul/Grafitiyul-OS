import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import {
  isUrlValue,
  shortenUrl,
  isLongText,
  LONG_TEXT_THRESHOLD,
  normalizeCardData,
} from './legacyCardCore.js';

// "מידע ממערכת קודמת" — the permanent legacy-info card.
//
// Read-only view of LegacyRecord.cardData (curated label→value pairs shaped
// at import time) for the entity this page shows. Renders NOTHING when the
// entity has no legacy records — existing pages stay visually unchanged.
// Collapsed by default; expanding reveals one section per legacy record
// (sourceType/sourceId shown small and muted between subtle dividers).

const SOURCE_SYSTEM_LABELS = { pipedrive: 'Pipedrive', airtable: 'Airtable' };

// One value cell: URLs become shortened external links; long text clamps
// behind a local "הצג עוד" toggle; everything else renders as-is (dir="auto"
// so Hebrew and Latin/numeric values each align naturally).
function ValueCell({ value }) {
  const [expanded, setExpanded] = useState(false);
  if (isUrlValue(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        title={value}
        dir="ltr"
        className="text-[13px] text-blue-700 hover:underline break-all"
      >
        {shortenUrl(value)}
      </a>
    );
  }
  const long = isLongText(value);
  const shown = long && !expanded ? `${value.slice(0, LONG_TEXT_THRESHOLD)}…` : value;
  return (
    <span dir="auto" className="text-[13px] text-gray-800 whitespace-pre-wrap break-words">
      {shown}
      {long && (
        <>
          {' '}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[12px] text-blue-600 hover:underline"
          >
            {expanded ? 'הצג פחות' : 'הצג עוד'}
          </button>
        </>
      )}
    </span>
  );
}

function RecordSection({ record, withDivider }) {
  const rows = normalizeCardData(record.cardData);
  if (!rows.length) return null;
  const sysLabel = SOURCE_SYSTEM_LABELS[record.sourceSystem] || record.sourceSystem;
  return (
    <div className={withDivider ? 'border-t border-gray-100 pt-3 mt-3' : ''}>
      {/* Small, muted provenance line — which legacy record this came from. */}
      <div className="mb-1.5 text-[11px] text-gray-400" dir="ltr">
        {sysLabel} · {record.sourceType} #{record.sourceId}
      </div>
      <dl className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[12px] text-gray-500">{row.label}</dt>
            <dd className="min-w-0 text-left">
              <ValueCell value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function LegacyInfoCard({ entityType, entityId }) {
  const [records, setRecords] = useState(null); // null = loading / not fetched
  const [open, setOpen] = useState(false); // collapsed by default

  useEffect(() => {
    let live = true;
    setRecords(null);
    setOpen(false);
    if (!entityType || !entityId) return undefined;
    api.legacyCard
      .get(entityType, entityId)
      .then((res) => { if (live) setRecords(res.records || []); })
      // A passive, read-only card: on failure it simply doesn't appear.
      .catch(() => { if (live) setRecords([]); });
    return () => { live = false; };
  }, [entityType, entityId]);

  // No legacy data (or still loading) → the page stays exactly as it was.
  const withRows = (records || []).filter((r) => normalizeCardData(r.cardData).length > 0);
  if (!withRows.length) return null;

  return (
    <section dir="rtl" className="overflow-hidden bg-white border border-gray-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-right hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-gray-900">מידע ממערכת קודמת</h2>
          {withRows.length > 1 && (
            <span className="text-[11px] font-medium text-gray-400">({withRows.length})</span>
          )}
        </span>
        <span className="text-gray-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3">
          {withRows.map((r, i) => (
            <RecordSection
              key={`${r.sourceSystem}:${r.sourceType}:${r.sourceId}`}
              record={r}
              withDivider={i > 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}
