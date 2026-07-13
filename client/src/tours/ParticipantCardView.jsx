import { useState } from 'react';
import RichText from '../editor/RichText.jsx';
import { participantsLabel } from '../portal/format.js';
import ProductBreakdown from './ProductBreakdown.jsx';

// Shared participant/customer card presentation — the ONE visual source of
// truth for the tour surfaces (admin Tour modal `CustomerCard` and the Guide
// Portal `ParticipantCard`). Hierarchy, typography and spacing live HERE so
// the two surfaces cannot drift apart again; each wrapper keeps its own
// concerns:
//   * data resolution — admin resolves booking.deal contacts client-side,
//     the portal reads the permission-gated guide DTO
//   * interactivity — admin links the identity block to the Deal (new tab),
//     the portal never links; each passes its own corner content (deal #,
//     status badge, coordination action)
// Props are plain display values only — no Deal/DTO shapes cross this
// boundary, so the shared layer cannot leak data between surfaces.
//
// Fixed hierarchy: customer/contact name → organization (· unit) →
// "👥 N משתתפים" → phone/email/field-rep row → "מידע חשוב על הלקוח".
export default function ParticipantCardView({
  customerName,
  organizationLine,
  seats,
  byProduct = null, // canonical purchased composition (participants.js) — when
  // present, the per-customer product→ticket breakdown REPLACES the bare seats
  // line (PART 3). Empty/absent → the "👥 N משתתפים" fallback.
  identityHref = null, // present → the identity block opens the Deal (admin)
  identityTitle = null,
  corner = null, // ReactNode column on the far edge; omitted → column disappears
  phone = null,
  email = null,
  fieldRepName = null,
  customerInfo = null, // trusted rich HTML authored in the Deal's note editor
  children = null, // surface extras (dialogs) — mounted inside the card
}) {
  const [infoOpen, setInfoOpen] = useState(true); // operationally important → open

  const identityRows = (
    <>
      <div
        className={`truncate text-[15px] font-semibold text-gray-900${
          identityHref ? ' hover:text-blue-700' : ''
        }`}
      >
        {customerName}
      </div>
      <div className="truncate text-[12.5px] text-gray-500">{organizationLine}</div>
      {byProduct?.length ? (
        <div className="mt-1.5">
          <ProductBreakdown byProduct={byProduct} />
        </div>
      ) : (
        <div className="mt-0.5 text-[13px] font-medium text-gray-700">
          👥 {participantsLabel(seats)}
        </div>
      )}
    </>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 p-3">
        {identityHref ? (
          <a
            href={identityHref}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 text-right"
            title={identityTitle}
          >
            {identityRows}
          </a>
        ) : (
          <div className="min-w-0">{identityRows}</div>
        )}
        {corner && <div className="flex shrink-0 flex-col items-end gap-1.5">{corner}</div>}
      </div>

      {(phone || email || fieldRepName) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 px-3 py-2 text-[13px]">
          {phone && (
            <a
              href={`tel:${phone}`}
              dir="ltr"
              className="tabular-nums text-blue-700 hover:underline active:underline"
            >
              📞 {phone}
            </a>
          )}
          {email && (
            <a
              href={`mailto:${email}`}
              dir="ltr"
              className="break-all text-blue-700 hover:underline active:underline"
            >
              ✉ {email}
            </a>
          )}
          {fieldRepName && (
            <span className="text-gray-600">
              נציג בשטח: <span className="font-medium text-gray-800">{fieldRepName}</span>
            </span>
          )}
        </div>
      )}

      {customerInfo && (
        <div className="border-t border-gray-100 px-3 py-2">
          <button
            type="button"
            onClick={() => setInfoOpen((o) => !o)}
            className="flex w-full items-center justify-between text-[13px] font-semibold text-gray-700 hover:text-gray-900"
          >
            <span>מידע חשוב על הלקוח</span>
            <span className="text-xs text-gray-400">{infoOpen ? '▾' : '▸'}</span>
          </button>
          {/* customerInfo is authored in the Deal's COMPACT note editor
              (CollapsibleNote) — its display parity partner is the TIGHT
              face, same as the Deal page shows this exact field. Rendered
              through the canonical RichText path (CLAUDE.md §16). */}
          {infoOpen && <RichText html={customerInfo} tight className="mt-1.5" />}
        </div>
      )}

      {children}
    </div>
  );
}
