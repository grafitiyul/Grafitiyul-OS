import { useEffect, useState } from 'react';
import { migrationApi } from '../api.js';

// One source record from Snapshot #1, as clean label→value rows. Never raw JSON.
// Reused by the Snapshot Browser tab AND as the evidence drawer in review queues.
export default function SourceRecord({ entity, id, onOpenRef }) {
  const [rec, setRec] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRec(null); setError(null);
    if (!entity || id == null) return undefined;
    migrationApi.browserRecord(entity, id)
      .then((r) => { if (!cancelled) setRec(r); })
      .catch((e) => { if (!cancelled) setError(e?.status === 503 ? 'הצילום טרם אונדקס' : 'הרשומה לא נמצאה'); });
    return () => { cancelled = true; };
  }, [entity, id]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(String(rec.sourceId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — the id is visible on screen anyway */ }
  }

  if (error) return <div className="text-sm text-gray-500 p-4">{error}</div>;
  if (!rec) return <div className="text-sm text-gray-400 p-4">טוען…</div>;

  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2 pb-3 mb-3 border-b border-gray-100">
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{rec.sourceSystem}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{rec.entity.label}</span>
        <button
          type="button"
          onClick={copyId}
          className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
          title="העתקת מזהה המקור"
        >
          {copied ? 'הועתק ✓' : `מזהה מקור: ${rec.sourceId}`}
        </button>
      </div>
      <dl className="space-y-2">
        {rec.fields.map((f) => (
          <div key={f.key} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 items-baseline">
            <dt className={`text-[12px] ${f.technical ? 'text-gray-400' : 'text-gray-500'} break-words`}>
              {f.technical ? 'שדה מותאם' : f.label}
            </dt>
            <dd className="text-gray-900 break-words">
              {f.ref && onOpenRef ? (
                <button type="button" onClick={() => onOpenRef(f.ref)} className="text-blue-700 hover:underline">
                  {f.display}
                </button>
              ) : (
                f.display
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
