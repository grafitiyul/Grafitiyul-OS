// READ-ONLY activity-component chips — THE one compact presentation used
// everywhere a component collection is DISPLAYED (Deal tour popover, planning
// card, any future read surface). Chips flow INLINE and wrap naturally
// (flex-wrap) — never one chip per line; read mode optimizes for scanning.
// Editing surfaces stay on TourComponents (add/remove/reorder ergonomics).
// Neutral chip styling matches the TourComponents edit chips: the icon carries
// the identity; strong colors are reserved for team roles.

export function ComponentChip({ component, workshopLocation }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[12px] font-medium text-gray-700">
      {component?.icon && <span aria-hidden>{component.icon}</span>}
      {component?.nameHe || '—'}
      {component?.isWorkshop && workshopLocation && (
        <span className="font-normal text-gray-500">📍 {workshopLocation.nameHe}</span>
      )}
    </span>
  );
}

// rows: TourEventActivityComponent / DealTourPlanActivityComponent /
// ProductVariantActivityComponent shapes — anything with { id,
// activityComponent, workshopLocation? }.
export default function ComponentChipList({ rows = [], empty = 'לא הוגדרו מרכיבים.' }) {
  if (!rows.length) return <p className="text-[12.5px] text-gray-400">{empty}</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {rows.map((row) => (
        <ComponentChip
          key={row.id}
          component={row.activityComponent}
          workshopLocation={row.workshopLocation}
        />
      ))}
    </div>
  );
}
