// Shared purchased-ticket breakdown presentation — product (card) → ticket types
// → quantities. The ONE renderer for the canonical participants.js breakdown
// (`byProduct`), used by the admin Tour modal (aggregate + per-customer) AND the
// Guide Portal participant cards, so the two surfaces cannot drift. GENERIC: it
// renders only the products/ticket types present in the data — no product name
// or "adult/child" is hardcoded.
export default function ProductBreakdown({ byProduct }) {
  if (!byProduct?.length) return null;
  return (
    <div className="space-y-1.5">
      {byProduct.map((p) => (
        <div key={p.key}>
          <div className="flex items-baseline gap-1.5 text-[12.5px] font-semibold text-gray-800">
            <span>{p.label}</span>
            <span className="text-[11px] font-normal tabular-nums text-gray-400">({p.total})</span>
          </div>
          <ul className="mt-0.5 mr-3 space-y-0.5">
            {p.ticketTypes.map((tt) => (
              <li key={tt.key} className="flex items-baseline justify-between gap-4 text-[12px] text-gray-600">
                <span>• {tt.label}</span>
                <span className="font-bold tabular-nums text-gray-900">{tt.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
