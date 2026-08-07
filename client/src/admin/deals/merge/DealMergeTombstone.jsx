import { Link } from 'react-router-dom';

// The retired-deal TOMBSTONE, and its mirror on the surviving deal.
//
// A merged-away deal is not deleted and not hidden: it opens normally and shows
// its whole history, because that history is real and someone may need to read
// it. What it must never do is look like a deal someone can still work on. This
// banner is what makes the difference legible in the first second — deliberately
// a full-width bar above everything, not a subtle badge.
//
// A silent redirect was considered and rejected: an operator who typed #27100
// and landed on #27042 with no explanation would reasonably think the system
// lost their deal. Being told what happened, with one click to the live deal,
// is the honest version.

export function RetiredBanner({ tombstone }) {
  if (!tombstone) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-amber-900">
            {tombstone.messageHe}
          </div>
          <p className="mt-0.5 text-[12.5px] text-amber-800">
            הדיל הזה אינו פעיל יותר וניתן לצפייה בלבד. כל עבודה חדשה — עריכה, תשלום, סיור, הודעות —
            נעשית בדיל הפעיל. ההיסטוריה, התשלומים והמסמכים של הדיל הזה נשמרו במלואם ומוצגים גם שם.
          </p>
          {/* A merge that was itself merged onward: show the whole chain rather
              than teleporting the operator two steps with no explanation. */}
          {tombstone.hops?.length > 1 && (
            <p className="mt-1 text-[11.5px] text-amber-700">
              שרשרת איחודים: {tombstone.hops.map((h) => `#${h.orderNo}`).join(' ← ')}
            </p>
          )}
        </div>
        <Link
          to={tombstone.survivorPath}
          className="shrink-0 rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-950"
        >
          פתח את דיל #{tombstone.survivorOrderNo}
        </Link>
      </div>
    </div>
  );
}

// The survivor's side of the same fact. Quiet by design — this deal is fully
// alive and the merge is context, not a warning.
export function AbsorbedNote({ mergedFrom }) {
  if (!mergedFrom?.length) return null;
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600" dir="rtl">
      אוחדו לדיל זה:{' '}
      {mergedFrom.map((d, i) => (
        <span key={d.dealId}>
          {i > 0 && ', '}
          <Link to={d.path} className="font-semibold text-gray-800 underline decoration-gray-300 hover:decoration-gray-600">
            #{d.orderNo}
          </Link>
        </span>
      ))}
      . ההיסטוריה, התשלומים והמסמכים שלהם מוצגים כאן יחד עם של הדיל הזה.
    </div>
  );
}

export default function DealMergeTombstone({ deal }) {
  return (
    <>
      <RetiredBanner tombstone={deal?.mergeTombstone} />
      <AbsorbedNote mergedFrom={deal?.mergedFrom} />
    </>
  );
}
